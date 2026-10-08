// Regression checks for the persistent translation memory (keys, fingerprints,
// retention, incognito bypass, fail-open client, executor integration).
// Imported from regression-main.mjs, which sets up the browser/DOM globals.
import assert from 'node:assert/strict';

const {
  TM_MESSAGE_TYPES,
  buildParagraphFingerprintSource,
  buildWordFingerprintSource,
  canonicalJson,
  deriveSegmentKey,
  endpointIdentity,
  hash128,
  isEntryExpired,
  planEviction,
  resolveTmPolicy,
  sanitizePairs,
} = await import('../src/modules/core/translation/TranslationMemoryShared.ts');
const {
  TranslationMemoryClient,
  createTranslationMemoryLayer,
  hitToCachedTranslation,
} = await import('../src/modules/core/translation/TranslationMemoryClient.ts');
const { TranslationMemoryService } = await import(
  '../src/modules/background/services/TranslationMemoryService.ts'
);
const { BatchTranslationExecutor } = await import(
  '../src/modules/core/translation/BatchTranslationExecutor.ts'
);
const { SegmentTranslationCache } = await import(
  '../src/modules/core/translation/SegmentTranslationCache.ts'
);

const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// Keys and fingerprints
// ------------------------------------------------------------

const fpHash = await hash128('fingerprint');
assert.match(fpHash, /^[A-Za-z0-9_-]{22}$/, '128-bit base64url hash');
assert.equal(
  await deriveSegmentKey(fpHash, '  Hello​   world\n'),
  await deriveSegmentKey(fpHash, 'Hello world'),
  'whitespace and zero-width characters do not change the key',
);
assert.notEqual(
  await deriveSegmentKey(fpHash, 'Hello world'),
  await deriveSegmentKey(await hash128('other'), 'Hello world'),
  'a different fingerprint gives a different key',
);
assert.notEqual(
  await deriveSegmentKey(fpHash, 'Hello world'),
  await deriveSegmentKey(fpHash, 'Hello World'),
  'case is significant',
);

assert.equal(
  canonicalJson({ b: 1, a: { d: [1, undefined], c: undefined } }),
  canonicalJson({ a: { d: [1, undefined] }, b: 1 }),
  'canonical JSON ignores key order and undefined members',
);

const wordParts = {
  protocolFamily: 'openai-compatible',
  endpoint: 'https://api.example.com/v1/chat/completions?key=secret',
  model: 'gpt-4o-mini',
  temperature: 0,
  customParams: '',
  thinking: null,
  systemPrompt: 'system A',
  batchSystemPrompt: 'batch A',
  promptVersion: '2',
  targetLanguage: 'en',
  userLevel: 3,
  replacementRate: 0.3,
};
const reordered = Object.fromEntries(Object.entries(wordParts).reverse());
assert.equal(
  buildWordFingerprintSource(wordParts),
  buildWordFingerprintSource(reordered),
  'fingerprint is stable across property order',
);
assert.ok(
  !buildWordFingerprintSource(wordParts).includes('secret'),
  'query strings (credentials) never enter the fingerprint',
);
assert.equal(
  endpointIdentity('https://api.example.com/v1/chat/completions/?x=1#y'),
  'https://api.example.com/v1/chat/completions',
);
for (const [field, value] of [
  ['systemPrompt', 'system B'],
  ['batchSystemPrompt', 'batch B'],
  ['model', 'gpt-4o'],
  ['temperature', 0.7],
  ['thinking', false],
  ['userLevel', 4],
  ['replacementRate', 0.5],
  ['targetLanguage', 'de'],
  ['customParams', '{"top_p":0.5}'],
]) {
  assert.notEqual(
    buildWordFingerprintSource({ ...wordParts, [field]: value }),
    buildWordFingerprintSource(wordParts),
    `${field} is part of the fingerprint`,
  );
}
assert.notEqual(
  buildParagraphFingerprintSource({
    model: 'gpt-4o-mini',
    promptTemplate: 'T',
    targetLanguage: 'en',
  }),
  buildParagraphFingerprintSource({
    model: 'gpt-4o-mini',
    promptTemplate: 'T',
    targetLanguage: 'de',
  }),
  'paragraph fingerprint includes the target language',
);

// ------------------------------------------------------------
// Policy, TTL and eviction
// ------------------------------------------------------------

assert.deepEqual(resolveTmPolicy(undefined), {
  enabled: true,
  maxEntries: 20000,
  ttlDays: 30,
});
assert.deepEqual(
  resolveTmPolicy({ enabled: false, maxEntries: 5, ttlDays: 9999 }),
  { enabled: false, maxEntries: 1000, ttlDays: 365 },
  'settings are clamped',
);

const policy = resolveTmPolicy({ maxEntries: 1000, ttlDays: 30 });
const now = 100 * DAY;
assert.equal(
  isEntryExpired({ status: 'ok', createdAt: now - 29 * DAY }, now, policy),
  false,
);
assert.equal(
  isEntryExpired({ status: 'ok', createdAt: now - 31 * DAY }, now, policy),
  true,
);
assert.equal(
  isEntryExpired({ status: 'empty', createdAt: now - 4 * DAY }, now, policy),
  true,
  'empty answers expire after 3 days',
);

const metas = Array.from({ length: 1005 }, (_, index) => ({
  key: `k${index}`,
  status: 'ok',
  createdAt: now - DAY,
  lastAccess: now - DAY + index,
}));
metas.push({
  key: 'expired',
  status: 'ok',
  createdAt: now - 40 * DAY,
  lastAccess: now,
});
const doomed = planEviction(metas, now, policy);
assert.ok(doomed.includes('expired'), 'expired entries are swept');
assert.equal(
  doomed.length,
  1 + (1005 - 900),
  'above the cap, the oldest entries are evicted down to 90 % of the cap',
);
assert.ok(doomed.includes('k0') && !doomed.includes('k1004'));
assert.deepEqual(planEviction(metas.slice(0, 10), now, policy), []);

assert.deepEqual(
  sanitizePairs([['a', 'b'], ['', 'x'], ['c'], 'bad', ['d', 'e', 'f']]),
  [
    ['a', 'b'],
    ['d', 'e'],
  ],
);

// ------------------------------------------------------------
// Background service (in-memory backend instead of IndexedDB)
// ------------------------------------------------------------

function createMemoryBackend() {
  const rows = new Map();
  const backend = {
    rows,
    calls: { getMany: 0, putMany: 0 },
    failing: false,
    async getMany(keys) {
      backend.calls.getMany++;
      if (backend.failing) throw new Error('db down');
      return keys.map((key) =>
        rows.has(key) ? structuredClone(rows.get(key)) : undefined,
      );
    },
    async putMany(entries) {
      backend.calls.putMany++;
      if (backend.failing) throw new Error('db down');
      for (const entry of entries) rows.set(entry.key, structuredClone(entry));
    },
    async deleteMany(keys) {
      for (const key of keys) rows.delete(key);
    },
    async count() {
      return rows.size;
    },
    async scan(visit) {
      for (const entry of rows.values()) visit(structuredClone(entry));
    },
    async clear() {
      rows.clear();
    },
  };
  return backend;
}

let clock = now;
let currentPolicy = resolveTmPolicy({});
const backend = createMemoryBackend();
const makeService = () =>
  new TranslationMemoryService({
    backend,
    now: () => clock,
    loadPolicy: async () => currentPolicy,
  });

const fp = buildWordFingerprintSource(wordParts);
const service = makeService();
assert.equal(
  await service.store(fp, [
    { text: 'Hello  world', status: 'ok', pairs: [['world', 'Welt']] },
    { text: 'Nothing here', status: 'empty', pairs: [] },
    { text: 'Broken', status: 'error', pairs: [['x', 'y']] },
    { text: 'Claims ok', status: 'ok', pairs: [] },
  ]),
  3,
  'errors are never stored',
);
assert.equal(backend.rows.size, 3);
assert.ok(
  [...backend.rows.values()].some(
    (row) => row.status === 'empty' && row.pairs.length === 0,
  ),
  'an "ok" without pairs is stored as empty',
);

// New service = service worker restart (empty L1), same IndexedDB
const restarted = makeService();
const lookup = await restarted.lookup(fp, [
  'Hello world',
  'Nothing here',
  'Broken',
  'Unknown',
]);
assert.deepEqual(lookup, [
  { status: 'ok', pairs: [['world', 'Welt']] },
  { status: 'empty', pairs: [] },
  null,
  null,
]);
const getManyCalls = backend.calls.getMany;
await restarted.lookup(fp, ['Hello world']);
assert.equal(
  backend.calls.getMany,
  getManyCalls,
  'second lookup is served from the in-memory L1',
);
await restarted.flushTouched();
const helloRow = [...backend.rows.values()].find(
  (row) => row.pairs[0]?.[1] === 'Welt',
);
assert.equal(helloRow.hits, 2, 'hit counts are written back');

assert.deepEqual(
  await restarted.lookup(
    buildWordFingerprintSource({ ...wordParts, model: 'x' }),
    ['Hello world'],
  ),
  [null],
  'a configuration change misses cleanly',
);

// Incognito: memory only, never IndexedDB
const putBefore = backend.calls.putMany;
const getBefore = backend.calls.getMany;
await restarted.store(
  fp,
  [{ text: 'Private text', status: 'ok', pairs: [['Private', 'Privat']] }],
  { incognito: true },
);
assert.equal(
  backend.calls.putMany,
  putBefore,
  'incognito stores stay in memory',
);
assert.deepEqual(
  await restarted.lookup(fp, ['Private text'], { incognito: true }),
  [{ status: 'ok', pairs: [['Private', 'Privat']] }],
);
assert.deepEqual(
  await restarted.lookup(fp, ['Unknown text'], { incognito: true }),
  [null],
);
assert.equal(
  backend.calls.getMany,
  getBefore,
  'incognito never reads IndexedDB',
);
assert.deepEqual(
  await restarted.lookup(fp, ['Private text']),
  [null],
  'regular tabs never see incognito entries',
);
assert.deepEqual(
  await restarted.handleMessage(
    { type: TM_MESSAGE_TYPES.LOOKUP, fp, texts: ['Hello world'] },
    { tab: { incognito: true } },
  ),
  { entries: [null] },
  'sender.tab.incognito selects the incognito map',
);

// TTL on read
clock = now + 31 * DAY;
const fresh = makeService();
assert.deepEqual(
  await fresh.lookup(fp, ['Hello world']),
  [null],
  'expired = miss',
);
await Promise.resolve();
assert.equal(
  [...backend.rows.values()].some((row) => row.pairs[0]?.[1] === 'Welt'),
  false,
  'expired entries are deleted on read',
);
clock = now;

// Disabled: no lookups, no stores
currentPolicy = resolveTmPolicy({ enabled: false });
const disabled = makeService();
assert.equal(
  await disabled.store(fp, [
    { text: 'Off', status: 'ok', pairs: [['Off', 'Aus']] },
  ]),
  0,
);
assert.deepEqual(await disabled.lookup(fp, ['Nothing here']), [null]);
currentPolicy = resolveTmPolicy({});

// Fail open on database errors
backend.failing = true;
const originalWarn = console.warn;
console.warn = () => undefined;
const failing = makeService();
assert.deepEqual(await failing.lookup(fp, ['Nothing here']), [null]);
assert.equal(
  await failing.store(fp, [
    { text: 'Later', status: 'ok', pairs: [['a', 'b']] },
  ]),
  1,
  'a failed write keeps the entry in memory',
);
backend.failing = false;
console.warn = originalWarn;

// Sweep and stats
currentPolicy = { enabled: true, maxEntries: 10, ttlDays: 30 };
const sweeper = makeService();
await sweeper.store(
  fp,
  Array.from({ length: 15 }, (_, index) => ({
    text: `Segment ${index}`,
    status: 'ok',
    pairs: [[`Segment`, `S${index}`]],
  })),
);
const evicted = await sweeper.runSweep(true);
assert.ok(evicted > 0 && backend.rows.size <= 9, 'sweep enforces the cap');
const stats = await sweeper.getStats();
assert.equal(stats.entries, backend.rows.size);
assert.ok(stats.approxBytes > 0);
assert.equal(stats.persistent, true);
const statsReply = await sweeper.handleMessage({
  type: TM_MESSAGE_TYPES.STATS,
});
assert.equal(statsReply.entries, backend.rows.size);
assert.deepEqual(
  await sweeper.handleMessage({ type: TM_MESSAGE_TYPES.CLEAR }),
  {
    success: true,
  },
);
assert.equal(backend.rows.size, 0, 'clear empties the store');
currentPolicy = resolveTmPolicy({});

// ------------------------------------------------------------
// Content-side client: batching and fail-open behaviour
// ------------------------------------------------------------

const sent = [];
const echoClient = new TranslationMemoryClient(
  async (message) => {
    sent.push(message);
    if (message.type === TM_MESSAGE_TYPES.LOOKUP) {
      return {
        entries: message.texts.map((text) =>
          text === 'hit' ? { status: 'ok', pairs: [['hit', 'Treffer']] } : null,
        ),
      };
    }
    return { stored: message.items.length };
  },
  { storeDelayMs: 1 },
);
const [lookupA, lookupB] = await Promise.all([
  echoClient.lookup('fp', ['hit', 'miss']),
  echoClient.lookup('fp', ['miss 2', 'hit']),
]);
assert.equal(sent.length, 1, 'lookups of one tick share one message');
assert.deepEqual(sent[0].texts, ['hit', 'miss', 'miss 2', 'hit']);
assert.deepEqual(lookupA, [
  { status: 'ok', pairs: [{ original: 'hit', translation: 'Treffer' }] },
  null,
]);
assert.equal(lookupB[0], null);
assert.equal(lookupB[1].pairs[0].translation, 'Treffer');

echoClient.store('fp', [
  {
    text: 'a',
    outcome: { status: 'ok', pairs: [{ original: 'a', translation: 'A' }] },
  },
]);
echoClient.store('fp', [
  { text: 'b', outcome: { status: 'empty', pairs: [] } },
]);
await new Promise((resolve) => setTimeout(resolve, 10));
const storeMessages = sent.filter(
  (message) => message.type === TM_MESSAGE_TYPES.STORE,
);
assert.equal(storeMessages.length, 1, 'stores are buffered into one message');
assert.deepEqual(storeMessages[0].items, [
  { text: 'a', status: 'ok', pairs: [['a', 'A']] },
  { text: 'b', status: 'empty', pairs: [] },
]);

const rejecting = new TranslationMemoryClient(async () => {
  throw new Error('Extension context invalidated');
});
assert.deepEqual(await rejecting.lookup('fp', ['x', 'y']), [null, null]);
const hanging = new TranslationMemoryClient(
  () => new Promise(() => undefined),
  {
    lookupTimeoutMs: 5,
  },
);
assert.deepEqual(
  await hanging.lookup('fp', ['x']),
  [null],
  'slow lookups time out as misses',
);
const malformed = new TranslationMemoryClient(async () => ({
  entries: 'nope',
}));
assert.deepEqual(await malformed.lookup('fp', ['x']), [null]);
assert.equal(
  hitToCachedTranslation({ status: 'ok', pairs: [['', 'x']] }),
  null,
);
assert.equal(hitToCachedTranslation({ status: 'error', pairs: [] }), null);

const filteredSent = [];
const filteredLayer = createTranslationMemoryLayer(
  new TranslationMemoryClient(async (message) => {
    filteredSent.push(message);
    return { entries: message.texts.map(() => null) };
  }),
  'fp',
  (text) => text !== 'skip',
);
assert.deepEqual(await filteredLayer.lookup(['skip', 'keep']), [null, null]);
assert.deepEqual(
  filteredSent[0].texts,
  ['keep'],
  'non-persistable texts are not looked up',
);

// ------------------------------------------------------------
// Executor: one memory lookup per wave before any request
// ------------------------------------------------------------

const okOutcome = (translation) => ({
  status: 'ok',
  pairs: [{ original: 'w', translation }],
});
const memoryCalls = { lookups: [], stores: [] };
const memoryLayer = {
  async lookup(texts) {
    memoryCalls.lookups.push(texts);
    return texts.map((text) =>
      text.startsWith('remembered') ? okOutcome('mem') : null,
    );
  },
  store(items) {
    memoryCalls.stores.push(items);
  },
};
const requestedBatches = [];
const requestedSingles = [];
const executorBackend = {
  async translateOne(text) {
    requestedSingles.push(text);
    return text.startsWith('fails')
      ? { status: 'error', error: '500' }
      : okOutcome('single');
  },
  async translateMany(texts) {
    requestedBatches.push(texts);
    return {
      status: 'ok',
      items: texts.map((text) =>
        text.startsWith('fails')
          ? undefined
          : {
              original: text,
              processed: '',
              replacements: [
                {
                  original: 'w',
                  translation: 'batch',
                  position: { start: 0, end: 1 },
                  isNew: true,
                },
              ],
              status: 'ok',
            },
      ),
    };
  },
};
const memoryExecutor = new BatchTranslationExecutor(
  new SegmentTranslationCache(20),
  executorBackend,
  { maxItems: 8, maxChars: 2500 },
  memoryLayer,
);
const waveTexts = [
  'remembered one',
  'new two',
  'fails three',
  'remembered one',
  'new four',
];
const waveOutcomes = await memoryExecutor.translate(waveTexts, waveTexts);
assert.deepEqual(
  memoryCalls.lookups,
  [['remembered one', 'new two', 'fails three', 'new four']],
  'one batched lookup for all unique in-page misses',
);
assert.deepEqual(
  requestedBatches,
  [['new two', 'fails three', 'new four']],
  'memory hits are never sent to the model',
);
assert.deepEqual(
  waveOutcomes.map((outcome) =>
    outcome.status === 'error' ? 'error' : outcome.pairs[0].translation,
  ),
  ['mem', 'batch', 'error', 'mem', 'batch'],
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  memoryCalls.stores.flat().map((item) => item.text),
  ['new two', 'new four'],
  'only successful answers are stored',
);

const brokenMemoryExecutor = new BatchTranslationExecutor(
  new SegmentTranslationCache(20),
  executorBackend,
  { maxItems: 8, maxChars: 2500 },
  {
    lookup: async () => {
      throw new Error('boom');
    },
    store: () => undefined,
  },
);
const brokenOutcomes = await brokenMemoryExecutor.translate(
  ['alpha'],
  ['alpha'],
);
assert.equal(
  brokenOutcomes[0].pairs[0].translation,
  'single',
  'a failing memory is a miss',
);

// ------------------------------------------------------------
// Word exposure tracking (learning layer)
// ------------------------------------------------------------

const {
  aggregateWordDeltas,
  buildWordId,
  mergeWordRecord,
  normalizeLanguageTag,
} = await import('../src/modules/core/translation/TranslationMemoryShared.ts');
const { WordExposureRecorder } = await import(
  '../src/modules/core/translation/WordExposureRecorder.ts'
);

assert.equal(normalizeLanguageTag('en-US'), 'en');
assert.equal(normalizeLanguageTag(''), 'und');
assert.equal(buildWordId('de-DE', 'en', '  Haus '), 'de|en|haus');

const aggregated = aggregateWordDeltas('de', 'en', [
  { surface: 'Haus', translation: 'house', count: 2 },
  { surface: 'haus', translation: 'home', count: 1 },
  { surface: '', translation: 'x', count: 1 },
  { surface: 'Baum', translation: '', count: 1 },
  'garbage',
]);
assert.deepEqual(
  [...aggregated.keys()],
  ['de|en|haus'],
  'invalid items are dropped',
);
const hausDelta = aggregated.get('de|en|haus');
assert.equal(hausDelta.count, 3);

const firstRecord = mergeWordRecord(
  undefined,
  'de|en|haus',
  'de',
  'en',
  hausDelta,
  1000,
);
assert.deepEqual(firstRecord.translations, { house: 2, home: 1 });
assert.equal(firstRecord.exposures, 3);
assert.equal(firstRecord.firstSeen, 1000);
const secondRecord = mergeWordRecord(
  firstRecord,
  'de|en|haus',
  'de',
  'en',
  hausDelta,
  2000,
);
assert.equal(secondRecord.exposures, 6);
assert.equal(secondRecord.firstSeen, 1000);
assert.equal(secondRecord.lastSeen, 2000);

function createWordBackend() {
  const records = new Map();
  return {
    records,
    applyCalls: 0,
    async applyDeltas(deltas, at) {
      this.applyCalls++;
      for (const { id, srcLang, tgtLang, delta } of deltas) {
        records.set(
          id,
          mergeWordRecord(records.get(id), id, srcLang, tgtLang, delta, at),
        );
      }
    },
    async count() {
      return records.size;
    },
    async scan(visit) {
      for (const record of records.values()) visit(record);
    },
    async deleteOldest() {},
    async clear() {
      records.clear();
    },
  };
}

const wordBackend = createWordBackend();
const wordService = new TranslationMemoryService({
  backend: createMemoryBackend(),
  wordBackend,
  now: () => clock,
  loadPolicy: async () => resolveTmPolicy({}),
});
const wordMessage = {
  type: TM_MESSAGE_TYPES.WORDS_RECORD,
  srcLang: 'de',
  tgtLang: 'en',
  items: [
    { surface: 'Haus', translation: 'house', count: 2 },
    { surface: 'Baum', translation: 'tree', count: 1 },
  ],
};
assert.deepEqual(await wordService.handleMessage(wordMessage), { recorded: 2 });
assert.equal(wordBackend.applyCalls, 1, 'one transaction per message');
assert.deepEqual(
  await wordService.handleMessage(wordMessage, { tab: { incognito: true } }),
  { recorded: 0 },
  'incognito exposures are never recorded',
);
assert.equal(wordBackend.records.get('de|en|haus').exposures, 2);
const wordStats = await wordService.getStats();
assert.equal(wordStats.words, 2);
assert.equal(wordStats.wordExposures, 3);
assert.deepEqual(wordStats.topWords[0], {
  surface: 'haus',
  translation: 'house',
  exposures: 2,
});
await wordService.clear('words');
assert.equal(wordBackend.records.size, 0, 'clear words empties the word store');

const recorderSent = [];
const recorder = new WordExposureRecorder(
  async (message) => {
    recorderSent.push(message);
  },
  1,
  () => false,
);
recorder.record([{ original: 'Haus', translation: 'house' }]);
assert.equal(recorder.pendingCount, 0, 'disabled until configured');
recorder.configure({ enabled: true, srcLang: 'de-DE', tgtLang: 'en' });
recorder.record([
  { original: 'Haus', translation: 'house' },
  { original: 'haus', translation: 'house' },
  { original: 'Baum', translation: 'tree' },
]);
recorder.record([{ original: 'Haus', translation: 'house' }]);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(
  recorderSent.length,
  1,
  'exposures are sent in one debounced message',
);
assert.equal(recorderSent[0].srcLang, 'de');
assert.deepEqual(
  recorderSent[0].items.map((item) => [item.surface, item.count]),
  [
    ['Haus', 3],
    ['Baum', 1],
  ],
);
const incognitoRecorder = new WordExposureRecorder(
  async (message) => recorderSent.push(message),
  1,
  () => true,
);
incognitoRecorder.configure({ enabled: true, srcLang: 'de', tgtLang: 'en' });
incognitoRecorder.record([{ original: 'Haus', translation: 'house' }]);
assert.equal(
  incognitoRecorder.pendingCount,
  0,
  'incognito tabs record nothing',
);

// Hinted answers are stored complete (model pairs + glossary hint pairs)
const hintStores = [];
const hintExecutor = new BatchTranslationExecutor(
  new SegmentTranslationCache(20),
  executorBackend,
  { maxItems: 8, maxChars: 2500 },
  {
    lookup: async (texts) => texts.map(() => null),
    store: (items) => hintStores.push(...items),
  },
);
await hintExecutor.translate(
  ['hinted text'],
  ['hinted text'],
  [{ pairs: [{ original: 'hinted', translation: 'HINT' }], maxPairs: 5 }],
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  hintStores[0].outcome.pairs.map((pair) => pair.translation),
  ['single', 'HINT'],
  'the stored outcome includes the hint pairs (withHintPairs before store)',
);

// ------------------------------------------------------------
// Hover definitions (namespace 'definitions', tm_definitions)
// ------------------------------------------------------------

const { buildDefinitionFingerprintSource } = await import(
  '../src/modules/core/translation/TranslationMemoryShared.ts'
);
const definitionFp = buildDefinitionFingerprintSource({
  model: 'gpt-4o-mini',
  maxTokens: 100,
  systemPrompt: 'dictionary prompt',
});
assert.notEqual(
  definitionFp,
  buildDefinitionFingerprintSource({
    model: 'gpt-4o-mini',
    maxTokens: 100,
    systemPrompt: 'edited prompt',
  }),
  'definition prompt edits invalidate stored definitions',
);

const segmentRows = createMemoryBackend();
const definitionRows = createMemoryBackend();
const definitionsService = new TranslationMemoryService({
  backend: definitionRows,
  wordBackend: null,
  now: () => clock,
  loadPolicy: async () => resolveTmPolicy({}),
});
const mainService = new TranslationMemoryService({
  backend: segmentRows,
  wordBackend: null,
  definitions: definitionsService,
  now: () => clock,
  loadPolicy: async () => resolveTmPolicy({}),
});
await mainService.handleMessage({
  type: TM_MESSAGE_TYPES.STORE,
  ns: 'definitions',
  fp: definitionFp,
  items: [{ text: 'hello', status: 'ok', pairs: [['hello', 'interj. hi']] }],
});
assert.equal(definitionRows.rows.size, 1, 'definitions go to tm_definitions');
assert.equal(segmentRows.rows.size, 0, 'and never into tm_segments');
assert.deepEqual(
  await new TranslationMemoryService({
    backend: segmentRows,
    wordBackend: null,
    definitions: new TranslationMemoryService({
      backend: definitionRows,
      wordBackend: null,
      now: () => clock,
      loadPolicy: async () => resolveTmPolicy({}),
    }),
    now: () => clock,
    loadPolicy: async () => resolveTmPolicy({}),
  }).handleMessage({
    type: TM_MESSAGE_TYPES.LOOKUP,
    ns: 'definitions',
    fp: definitionFp,
    texts: ['hello', 'world'],
  }),
  { entries: [{ status: 'ok', pairs: [['hello', 'interj. hi']] }, null] },
  'definitions survive a background restart',
);
assert.equal((await mainService.getStats()).definitions, 1);
await mainService.clear('segments');
assert.equal(
  definitionRows.rows.size,
  0,
  'clearing the cache clears definitions',
);

const nsSent = [];
const nsClient = new TranslationMemoryClient(
  async (message) => {
    nsSent.push(message);
    return { entries: message.texts?.map(() => null) };
  },
  { storeDelayMs: 1 },
);
await Promise.all([
  nsClient.lookup('fp', ['a']),
  nsClient.lookup('fp', ['b'], 'definitions'),
]);
assert.deepEqual(
  nsSent.map((message) => [message.ns, message.texts]),
  [
    [undefined, ['a']],
    ['definitions', ['b']],
  ],
  'namespaces are never mixed in one message',
);

// End to end: a definition fetched in one tab is reused by another tab without an AI call
const { AITranslationProvider } = await import(
  '../src/modules/pronunciation/translation/AITranslationProvider.ts'
);
const { translationMemoryClient } = await import(
  '../src/modules/core/translation/TranslationMemoryClient.ts'
);
const e2eDefinitions = new TranslationMemoryService({
  backend: createMemoryBackend(),
  wordBackend: null,
  now: () => clock,
  loadPolicy: async () => resolveTmPolicy({}),
});
const e2eService = new TranslationMemoryService({
  backend: createMemoryBackend(),
  wordBackend: null,
  definitions: e2eDefinitions,
  now: () => clock,
  loadPolicy: async () => resolveTmPolicy({}),
});
const previousSendMessage = globalThis.browser.runtime.sendMessage;
globalThis.browser.runtime.sendMessage = (message) =>
  e2eService.handleMessage(message);

const hoverConfig = {
  id: 'cfg',
  name: 'cfg',
  protocolFamily: 'openai-compatible',
  config: {
    apiKey: 'key',
    apiEndpoint: 'https://api.example.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    temperature: 0,
  },
};
let aiCalls = 0;
const makeHoverProvider = () => {
  const provider = new AITranslationProvider(hoverConfig, 1000);
  provider.universalApi = {
    call: async () => {
      aiCalls++;
      return { success: true, content: 'interj. hi' };
    },
  };
  return provider;
};
const firstHover = await makeHoverProvider().getMeaning('Hello');
assert.equal(firstHover.data.explain, 'interj. hi');
await translationMemoryClient.flushStores();
const otherTab = await makeHoverProvider().getMeaning('hello');
assert.equal(otherTab.data.explain, 'interj. hi');
assert.equal(aiCalls, 1, 'the second tab reuses the persisted definition');
globalThis.browser.runtime.sendMessage = previousSendMessage;

console.log('translation memory regression passed');
