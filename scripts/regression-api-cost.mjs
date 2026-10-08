// Regression checks for the word-mode API cost pipeline (status handling, cache, batching).
// Imported from regression-main.mjs, which sets up the linkedom DOM globals.
import assert from 'node:assert/strict';

// ProcessingStateManager starts a long cleanup interval on import; keep it from holding the process open.
const nodeSetInterval = globalThis.setInterval;
window.setInterval = (...args) => {
  const timer = nodeSetInterval(...args);
  timer.unref?.();
  return timer;
};
window.clearInterval = clearInterval;

const { BaseProvider } = await import(
  '../src/modules/api/base/BaseProvider.ts'
);
const { StructuredTextParser } = await import(
  '../src/modules/api/utils/structuredTextParser.ts'
);
const { ProcessingCoordinator } = await import(
  '../src/modules/processing/ProcessingCoordinator.ts'
);
const { globalProcessingState } = await import(
  '../src/modules/processing/ProcessingStateManager.ts'
);
const { translationStats, extractTokenUsage } = await import(
  '../src/modules/core/translation/TranslationStats.ts'
);

const settings = {
  multilingualConfig: { targetLanguage: 'de', nativeLanguage: 'en' },
  userLevel: 3,
  replacementRate: 0.3,
};

// ---------- eq7.1: status handling ----------

class FakeProvider extends BaseProvider {
  constructor(impl) {
    super({ apiKey: 'key', apiEndpoint: 'https://example.test', model: 'm' });
    this.impl = impl;
  }
  getProviderName() {
    return 'Fake';
  }
  async doAnalyzeFullText(text) {
    return this.impl.call(this, text);
  }
}

const silenceErrors = async (fn) => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

const failed = await silenceErrors(() =>
  new FakeProvider(() => {
    throw new Error('HTTP 429');
  }).analyzeFullText('Some text to translate', settings),
);
assert.equal(
  failed.status,
  'error',
  'A thrown provider error must be reported as status error',
);
assert.equal(failed.replacements.length, 0);

const empty = await new FakeProvider((text) => ({
  original: text,
  processed: '',
  replacements: [],
})).analyzeFullText('Some text to translate', settings);
assert.equal(
  empty.status,
  'empty',
  'A valid answer without pairs is an empty success',
);

const noKey = await new FakeProvider(() => {
  throw new Error('must not be called');
});
noKey.config.apiKey = '';
assert.equal(
  (await noKey.analyzeFullText('Some text', settings)).status,
  'error',
  'A missing API key is an error, not an empty result',
);

const parsedEmpty = StructuredTextParser.parse('');
assert.equal(
  parsedEmpty.success,
  true,
  'An empty model answer parses successfully',
);
assert.equal(parsedEmpty.replacements.length, 0);

// The coordinator must not mark segments with failed translations as processed.
const makeSegment = (id, text) => {
  const element = document.createElement('p');
  element.textContent = text;
  document.body.appendChild(element);
  return {
    id,
    textContent: text,
    element,
    elements: [element],
    textNodes: [element.firstChild],
    fingerprint: `fp-${id}`,
    domPath: `body>p#${id}`,
  };
};

const errorEngine = {
  styleManager: { getCurrentStyleClass: () => 'wxt-style-default' },
  getConfig: () => ({ replacementRate: 0.3 }),
  replaceText: async (text) => ({
    original: text,
    processed: text,
    replacements: [],
    status: 'error',
    error: 'boom',
  }),
};
const failedSegment = makeSegment(
  'failed',
  'This sentence failed to translate.',
);
const failedRun = await new ProcessingCoordinator().processSegments(
  [failedSegment],
  errorEngine,
  0,
  'after',
  true,
);
assert.equal(failedRun.success, false);
assert.equal(
  globalProcessingState.isContentProcessed(failedSegment.fingerprint),
  false,
  'Failed segments must stay retryable',
);
assert.equal(
  globalProcessingState.isContentProcessing(failedSegment.fingerprint),
  false,
  'Failed segments must release their in-progress mark',
);

// ---------- eq7.10: instrumentation ----------

assert.deepEqual(
  extractTokenUsage({ prompt_tokens: 120, completion_tokens: 30 }),
  { inputTokens: 120, outputTokens: 30 },
  'OpenAI usage must be read',
);
assert.deepEqual(
  extractTokenUsage({ promptTokenCount: 80, candidatesTokenCount: 12 }),
  { inputTokens: 80, outputTokens: 12 },
  'Gemini usageMetadata must be read',
);
assert.equal(extractTokenUsage(undefined), null);

translationStats.reset();
await silenceErrors(() =>
  new FakeProvider(() => {
    throw new Error('HTTP 500');
  }).analyzeFullText('Some text to translate', settings),
);
await new FakeProvider(function (text) {
  this.recordUsage({ prompt_tokens: 50, completion_tokens: 10 });
  return { original: text, processed: '', replacements: [] };
}).analyzeFullText('Some text to translate', settings);
const statsSnapshot = translationStats.getSnapshot();
assert.equal(statsSnapshot.requests, 2);
assert.equal(statsSnapshot.errors, 1);
assert.equal(statsSnapshot.inputTokens, 50);
assert.equal(statsSnapshot.outputTokens, 10);

// ---------- eq7.2: in-page segment cache ----------

const {
  SegmentTranslationCache,
  LruCache,
  buildTranslationCacheKey,
  normalizeSegmentText,
  responseFromOutcome,
  toTranslationOutcome,
} = await import('../src/modules/core/translation/SegmentTranslationCache.ts');

const keyParts = {
  providerId: 'cfg-1',
  model: 'gpt-4o-mini',
  targetLanguage: 'de',
  userLevel: 3,
  replacementRate: 0.3,
  promptVersion: '1',
};
assert.equal(
  normalizeSegmentText(' Hello\u200B   world \n'),
  'Hello world',
  'Normalization strips zero-width chars and collapses whitespace',
);
assert.equal(
  buildTranslationCacheKey(keyParts, 'Hello  world'),
  buildTranslationCacheKey(keyParts, ' Hello world\u200D'),
  'Whitespace/zero-width variants share a cache key',
);
assert.notEqual(
  buildTranslationCacheKey(keyParts, 'Hello world'),
  buildTranslationCacheKey({ ...keyParts, model: 'gpt-4o' }, 'Hello world'),
  'Switching the model must not reuse cached answers',
);
assert.notEqual(
  buildTranslationCacheKey(keyParts, 'Hello world'),
  buildTranslationCacheKey({ ...keyParts, promptVersion: '2' }, 'Hello world'),
  'A prompt change must invalidate cached answers',
);
assert.ok(
  buildTranslationCacheKey(keyParts, 'Hello world').endsWith('Hello world'),
  'The key keeps the full normalized text instead of a 32-bit hash',
);

const lru = new LruCache(2);
lru.set('a', 1);
lru.set('b', 2);
lru.get('a');
lru.set('c', 3);
assert.equal(lru.has('a'), true, 'Recently used entries survive eviction');
assert.equal(lru.has('b'), false, 'The least recently used entry is evicted');

const segmentCache = new SegmentTranslationCache(10);
let fetchCount = 0;
let releaseFetch;
const slowFetch = () => {
  fetchCount++;
  return new Promise((resolve) => {
    releaseFetch = () =>
      resolve({
        status: 'ok',
        pairs: [{ original: 'world', translation: 'Welt' }],
      });
  });
};
const first = segmentCache.resolve('k', slowFetch);
const second = segmentCache.resolve('k', slowFetch);
await Promise.resolve();
releaseFetch();
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.equal(fetchCount, 1, 'Identical concurrent segments send one request');
assert.equal(firstResult.source, 'request');
assert.equal(secondResult.source, 'inflight');
assert.equal(
  (await segmentCache.resolve('k', slowFetch)).source,
  'cache',
  'The settled answer is cached',
);

const errorFetch = async () => ({ status: 'error', error: 'HTTP 429' });
assert.equal(
  (await segmentCache.resolve('err', errorFetch)).outcome.status,
  'error',
);
let retried = false;
await segmentCache.resolve('err', async () => {
  retried = true;
  return { status: 'empty', pairs: [] };
});
assert.equal(retried, true, 'Errors are never cached, the next caller retries');
assert.equal(
  (await segmentCache.resolve('err', errorFetch)).source,
  'cache',
  'A valid empty answer is cached',
);

const cachedOutcome = toTranslationOutcome({
  original: 'Hello world',
  processed: '',
  replacements: [
    {
      original: 'world',
      translation: 'Welt',
      position: { start: 6, end: 11 },
      isNew: true,
    },
  ],
});
const recomputed = responseFromOutcome('  Hello   world', cachedOutcome);
assert.deepEqual(
  recomputed.replacements[0].position,
  { start: 10, end: 15 },
  'Cached pairs get positions recomputed for the caller text',
);
assert.equal(
  toTranslationOutcome({ ...recomputed, status: 'error' }).status,
  'error',
);

console.log('api cost regression passed');
