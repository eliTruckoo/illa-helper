/**
 * Small promise semaphore.
 * Used per tab to cap concurrent word-mode translation requests across manual,
 * lazy-loading and dynamic-content runs.
 */

/** Maximum concurrent word-mode translation requests per tab */
export const MAX_CONCURRENT_TRANSLATION_REQUESTS = 4;

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  private acquire(): Promise<void> {
    if (this.active < Math.max(1, this.maxConcurrent)) {
      this.active++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // Hand the slot directly to the next waiter
      next();
      return;
    }
    this.active--;
  }
}
