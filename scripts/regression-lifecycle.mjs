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

// ------------------------------------------------------------
// Debounced task (illa-helper-bfn.6/.7)
// ------------------------------------------------------------

const { createDebouncedTask } = await import('../src/utils/debounce.ts');

function createManualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    runAll() {
      const entries = [...pending.entries()];
      pending.clear();
      entries.forEach(([, { callback }]) => callback());
    },
    size: () => pending.size,
  };
}

{
  const timers = createManualTimers();
  const calls = [];
  const task = createDebouncedTask((value) => calls.push(value), 400, timers);

  task.schedule(1);
  task.schedule(2);
  task.schedule(3);
  assert.equal(timers.size(), 1, 'rescheduling keeps a single pending timer');
  assert.equal(task.isPending(), true);
  timers.runAll();
  assert.deepEqual(calls, [3], 'only the last scheduled call runs');
  assert.equal(task.isPending(), false);

  task.schedule(4);
  task.flush();
  assert.deepEqual(calls, [3, 4], 'flush runs the pending call immediately');
  assert.equal(timers.size(), 0, 'flush clears the timer');
  task.flush();
  assert.deepEqual(calls, [3, 4], 'flush without a pending call is a no-op');

  task.schedule(5);
  task.cancel();
  timers.runAll();
  assert.deepEqual(calls, [3, 4], 'cancel drops the pending call');

  const throwing = createDebouncedTask(
    () => {
      throw new Error('boom');
    },
    10,
    timers,
  );
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    throwing.schedule();
    assert.doesNotThrow(() => throwing.flush(), 'task errors are contained');
  } finally {
    console.error = originalConsoleError;
  }
}

// ------------------------------------------------------------
// Context menu state diffing (illa-helper-bfn.6)
// ------------------------------------------------------------

const { computeMenuState, diffMenuState, hiddenMenuState, DYNAMIC_MENU_IDS } =
  await import('../src/modules/contextMenu/menuState.ts');

{
  const normal = computeMenuState('normal', 'example.com');
  assert.equal(
    Object.keys(normal).length,
    DYNAMIC_MENU_IDS.length,
    'the state covers every dynamic menu item',
  );
  assert.equal(normal['illa-remove-blacklist'].visible, false);
  assert.equal(
    normal['illa-add-blacklist-domain'].title,
    'Add example.com to blacklist',
  );

  assert.equal(
    diffMenuState({}, normal).length,
    DYNAMIC_MENU_IDS.length,
    'nothing applied yet: every item is updated',
  );
  assert.equal(
    diffMenuState(normal, computeMenuState('normal', 'example.com')).length,
    0,
    'unchanged state: no contextMenus.update calls',
  );

  const otherDomain = diffMenuState(
    normal,
    computeMenuState('normal', 'other.org'),
  );
  assert.deepEqual(
    otherDomain.map(([id]) => id).sort(),
    ['illa-add-blacklist-domain', 'illa-add-whitelist-domain'],
    'a domain change only retitles the domain items',
  );

  const blacklisted = diffMenuState(
    normal,
    computeMenuState('blacklisted', 'example.com'),
  );
  assert.deepEqual(
    blacklisted.map(([id]) => id).sort(),
    [
      'illa-add-blacklist-domain',
      'illa-add-blacklist-exact',
      'illa-remove-blacklist',
    ],
    'a status change only toggles the affected items',
  );

  const hidden = hiddenMenuState();
  const appliedHidden = {};
  for (const [id, item] of Object.entries(normal)) {
    appliedHidden[id] = { visible: false, title: item.title };
  }
  assert.equal(
    diffMenuState(appliedHidden, hidden).length,
    0,
    'hidden items with an old title need no update',
  );
}

console.log('lifecycle regression passed');
