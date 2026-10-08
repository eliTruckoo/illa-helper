/**
 * Retry and timeout policy for upstream API requests (pure functions, no I/O)
 */

export interface RetryPolicyConfig {
  /** Maximum number of retries after the first attempt */
  maxRetries: number;
  /** Base delay for exponential backoff in ms */
  baseDelay: number;
  /** Upper bound for a computed backoff delay in ms */
  maxDelay: number;
  /** A Retry-After longer than this gives up instead of waiting (ms) */
  maxRetryAfter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 8000,
  maxRetryAfter: 20000,
};

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

/**
 * Only request timeouts, rate limiting and server errors are transient.
 * Any other 4xx (auth, bad request, not found...) must never be retried.
 */
export function isRetryableStatus(status: number | undefined): boolean {
  if (typeof status !== 'number') return false;
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.round(Number(value) * 1000);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Exponential backoff with jitter: the delay for retry n (0-based) lies in
 * [base * 2^n / 2, base * 2^n], capped at maxDelay.
 */
export function computeBackoffDelay(
  retryIndex: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    config.maxDelay,
    config.baseDelay * Math.pow(2, retryIndex),
  );
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

/**
 * Decide whether a failed attempt should be retried and after how long
 * @param status HTTP status of the failed attempt (undefined for transport errors)
 * @param retriesDone Number of retries already performed
 * @param retryAfterMs Parsed Retry-After of the failed attempt
 */
export function getRetryDecision(
  status: number | undefined,
  retriesDone: number,
  retryAfterMs?: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): RetryDecision {
  if (!isRetryableStatus(status) || retriesDone >= config.maxRetries) {
    return { retry: false, delayMs: 0 };
  }
  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) {
    // The server told us how long to wait; give up if that is too long
    if (retryAfterMs > config.maxRetryAfter) {
      return { retry: false, delayMs: 0 };
    }
    return { retry: true, delayMs: retryAfterMs };
  }
  return {
    retry: true,
    delayMs: computeBackoffDelay(retriesDone, config, random),
  };
}

/**
 * Resolve the per-attempt timeout of a request.
 * - missing / invalid / negative: the default timeout
 * - 0 ("unlimited" chosen in the options): a generous safety ceiling, so a
 *   request can never stay in flight forever
 * - otherwise: the requested value
 */
export function resolveRequestTimeout(
  requested: number | undefined,
  defaultTimeout: number,
  unlimitedCeiling: number,
): number {
  if (
    typeof requested !== 'number' ||
    !Number.isFinite(requested) ||
    requested < 0
  ) {
    return defaultTimeout;
  }
  if (requested === 0) return unlimitedCeiling;
  return requested;
}
