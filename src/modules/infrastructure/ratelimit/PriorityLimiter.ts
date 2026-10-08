/**
 * Priority semaphore: at most `maxConcurrent` tasks run at once; waiting tasks
 * start in priority order (lower number first), FIFO within a priority.
 * Used by the background proxy as the global cap on upstream requests.
 */

export const REQUEST_PRIORITY = {
  /** Requests from the active tab or from extension pages */
  FOREGROUND: 0,
  /** Requests from background tabs */
  BACKGROUND: 1,
} as const;

export interface PriorityAcquireOptions<T> {
  priority?: number;
  /** Aborting while queued removes the waiter and rejects with an AbortError */
  signal?: AbortSignal;
  /** Caller data, used by reprioritize() */
  tag?: T;
}

interface Waiter<T> {
  priority: number;
  sequence: number;
  tag?: T;
  grant: (release: () => void) => void;
  cleanup: () => void;
}

export class PriorityLimiter<T = unknown> {
  private running = 0;
  private sequence = 0;
  private queue: Waiter<T>[] = [];

  constructor(private maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  setMaxConcurrent(maxConcurrent: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.drain();
  }

  /**
   * Wait for a slot. Resolves with a release function that must be called
   * exactly once (extra calls are ignored).
   */
  acquire(options: PriorityAcquireOptions<T> = {}): Promise<() => void> {
    const { signal } = options;
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.running < this.maxConcurrent && this.queue.length === 0) {
      this.running++;
      return Promise.resolve(this.createRelease());
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(createAbortError());
        }
      };
      const waiter: Waiter<T> = {
        priority: options.priority ?? REQUEST_PRIORITY.FOREGROUND,
        sequence: this.sequence++,
        tag: options.tag,
        grant: resolve,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.insert(waiter);
    });
  }

  /**
   * Run a task inside a slot
   */
  async run<R>(
    task: () => Promise<R>,
    options: PriorityAcquireOptions<T> = {},
  ): Promise<R> {
    const release = await this.acquire(options);
    try {
      return await task();
    } finally {
      release();
    }
  }

  /**
   * Change the priority of queued waiters whose tag matches
   */
  reprioritize(match: (tag: T | undefined) => boolean, priority: number): void {
    let changed = false;
    for (const waiter of this.queue) {
      if (waiter.priority !== priority && match(waiter.tag)) {
        waiter.priority = priority;
        changed = true;
      }
    }
    if (changed) {
      this.queue.sort(compareWaiters);
    }
  }

  private insert(waiter: Waiter<T>): void {
    let index = this.queue.length;
    while (index > 0 && compareWaiters(this.queue[index - 1], waiter) > 0) {
      index--;
    }
    this.queue.splice(index, 0, waiter);
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      waiter.cleanup();
      this.running++;
      waiter.grant(this.createRelease());
    }
  }
}

function compareWaiters<T>(a: Waiter<T>, b: Waiter<T>): number {
  return a.priority - b.priority || a.sequence - b.sequence;
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
