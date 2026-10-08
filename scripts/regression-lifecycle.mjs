// Regression checks for lifecycle/startup logic (update-check gating,
// debounced saving).
// Imported from regression-main.mjs, which sets up the linkedom DOM globals
// and the `browser` mock.
import assert from 'node:assert/strict';

// ------------------------------------------------------------
// Update check gating (illa-helper-bfn.5)
// ------------------------------------------------------------

const { isUpdateCheckDue, UPDATE_CHECK_INTERVAL_MS } = await import(
  '../src/modules/background/services/updateCheckSchedule.ts'
);

const DAY = UPDATE_CHECK_INTERVAL_MS;
const now = 10 * DAY;

assert.equal(isUpdateCheckDue([], now), true, 'never checked: due');
assert.equal(
  isUpdateCheckDue([undefined, null, 'x', NaN], now),
  true,
  'invalid timestamps are ignored',
);
assert.equal(
  isUpdateCheckDue([now - DAY + 1000], now),
  false,
  'checked less than 24 h ago: not due',
);
assert.equal(
  isUpdateCheckDue([now - DAY], now),
  true,
  'checked exactly 24 h ago: due',
);
assert.equal(
  isUpdateCheckDue([now - 3 * DAY, now - 60_000], now),
  false,
  'the most recent of check/attempt timestamps wins',
);
assert.equal(
  isUpdateCheckDue([now + DAY], now),
  true,
  'a timestamp in the future (clock skew) does not block checks',
);

console.log('lifecycle regression passed');
