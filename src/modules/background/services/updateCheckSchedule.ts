/**
 * Update check scheduling - pure helpers, kept free of browser APIs so they
 * can be covered by the regression script.
 */

/** Name of the browser.alarms alarm that drives the periodic update check */
export const UPDATE_CHECK_ALARM = 'illa-update-check';

/** Minimum time between two automatic update checks (24 h) */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Alarm period in minutes (matches UPDATE_CHECK_INTERVAL_MS) */
export const UPDATE_CHECK_PERIOD_MINUTES = UPDATE_CHECK_INTERVAL_MS / 60000;

/** Delay of the first alarm after it is (re)created, in minutes */
export const UPDATE_CHECK_INITIAL_DELAY_MINUTES = 1;

/**
 * Whether an automatic update check is due.
 *
 * @param lastChecks timestamps (ms) of earlier checks/attempts; missing or
 *   invalid values are ignored
 * @param now current time (ms)
 * @param intervalMs minimum time between checks
 */
export function isUpdateCheckDue(
  lastChecks: unknown[],
  now: number,
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  const valid = lastChecks.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  if (valid.length === 0) return true;

  const latest = Math.max(...valid);
  // A timestamp in the future means the clock went backwards: check again.
  if (latest > now) return true;

  return now - latest >= intervalMs;
}
