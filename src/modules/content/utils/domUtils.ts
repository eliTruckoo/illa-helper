import { isProcessingResultNode as isProcessingPipelineNode } from '../../processing/DomTranslationPolicy';

/**
 * Check whether a node is a processing result node (translation, pronunciation, and other feature elements)
 */
export function isProcessingResultNode(node: Node): boolean {
  return isProcessingPipelineNode(node);
}

/**
 * Check whether a node is a descendant of any other node in the set
 */
export function isDescendant(node: Node, nodeSet: Set<Node>): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (nodeSet.has(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Timer functions used by createBatchScheduler (injectable for tests).
 */
export interface SchedulerClock {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const defaultClock: SchedulerClock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface BatchScheduler {
  /** Request a flush (debounced, bounded by maxWait) */
  schedule(): void;
  /** Drop a pending flush */
  cancel(): void;
  isScheduled(): boolean;
}

/**
 * Trailing debounce with a maximum wait.
 *
 * Every schedule() pushes the flush back by `wait`, but never further than
 * `maxWait` after the first schedule() of the current batch. Pages that mutate
 * continuously (chats, tickers, timestamps) therefore still get flushed at
 * least every `maxWait` instead of starving forever.
 */
export function createBatchScheduler(
  flush: () => void,
  options: { wait: number; maxWait: number },
  clock: SchedulerClock = defaultClock,
): BatchScheduler {
  let handle: unknown;
  let scheduled = false;
  let batchStartedAt = 0;

  const run = () => {
    scheduled = false;
    handle = undefined;
    flush();
  };

  return {
    schedule() {
      const now = clock.now();
      if (!scheduled) {
        batchStartedAt = now;
      } else {
        clock.clearTimeout(handle);
      }

      const untilMaxWait = batchStartedAt + options.maxWait - now;
      const delay = Math.max(0, Math.min(options.wait, untilMaxWait));
      scheduled = true;
      handle = clock.setTimeout(run, delay);
    },
    cancel() {
      if (scheduled) {
        clock.clearTimeout(handle);
      }
      scheduled = false;
      handle = undefined;
    },
    isScheduled() {
      return scheduled;
    },
  };
}
