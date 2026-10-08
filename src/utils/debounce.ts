/**
 * Trailing-edge debounce with explicit flush/cancel.
 *
 * Unlike a plain debounce, the pending call can be flushed synchronously
 * (e.g. on unmount or pagehide, so a pending save is not lost) or cancelled.
 * Free of browser APIs so it can be used in every context and in tests.
 */

export interface DebounceTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface DebouncedTask<Args extends unknown[]> {
  /** (Re)start the wait; the last scheduled arguments win */
  schedule(...args: Args): void;
  /** Run the pending call now, if any */
  flush(): void;
  /** Drop the pending call, if any */
  cancel(): void;
  /** Whether a call is pending */
  isPending(): boolean;
}

const defaultTimers: DebounceTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createDebouncedTask<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  wait: number,
  timers: DebounceTimers = defaultTimers,
): DebouncedTask<Args> {
  let handle: unknown = null;
  let pendingArgs: Args | null = null;

  const run = (): void => {
    if (handle !== null) {
      timers.clearTimeout(handle);
      handle = null;
    }
    if (!pendingArgs) return;
    const args = pendingArgs;
    pendingArgs = null;
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch((error) => {
          console.error('[debounce] Debounced task failed:', error);
        });
      }
    } catch (error) {
      console.error('[debounce] Debounced task failed:', error);
    }
  };

  return {
    schedule(...args: Args): void {
      pendingArgs = args;
      if (handle !== null) timers.clearTimeout(handle);
      handle = timers.setTimeout(run, wait);
    },
    flush: run,
    cancel(): void {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      pendingArgs = null;
    },
    isPending(): boolean {
      return pendingArgs !== null;
    },
  };
}
