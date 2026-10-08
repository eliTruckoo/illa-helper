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

// ---------- ei3.6: per-tab request limiter ----------

const { ConcurrencyLimiter } = await import(
  '../src/modules/core/translation/ConcurrencyLimiter.ts'
);
const limiter = new ConcurrencyLimiter(2);
let running = 0;
let peak = 0;
await Promise.all(
  Array.from({ length: 6 }, () =>
    limiter.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    }),
  ),
);
assert.equal(peak, 2, 'The per-tab limiter caps concurrent requests');
assert.equal(limiter.activeCount, 0);

// ---------- eq7.4: prompt and output caps ----------

const { promptService, getSystemPromptByConfig } = await import(
  '../src/modules/core/translation/PromptService.ts'
);
const { estimateMaxOutputTokens } = await import(
  '../src/modules/api/utils/textUtils.ts'
);
const { supportsOpenAIOutputCap, getGeminiOutputConfig } = await import(
  '../src/modules/api/utils/apiUtils.ts'
);
const { countTranslationUnits, calculateReplacementLimit, ReplacementBudget } =
  await import('../src/modules/processing/ReplacementBudget.ts');

const systemPrompt = getSystemPromptByConfig({
  targetLanguage: 'de',
  userLevel: 3,
  replacementRate: 0.3,
});
assert.ok(systemPrompt.length < 900, 'The system prompt stays short');
assert.match(systemPrompt, /original\|\|translation/);
assert.match(systemPrompt, /30%/);
assert.match(promptService.getUserPrompt('Hello world', 2), /at most 2 lines/);

assert.equal(estimateMaxOutputTokens(3), 3 * 15 + 40);
assert.equal(estimateMaxOutputTokens(undefined), undefined);
assert.equal(supportsOpenAIOutputCap({ model: 'gpt-4o-mini' }), true);
assert.equal(supportsOpenAIOutputCap({ model: 'o3-mini' }), false);
assert.equal(supportsOpenAIOutputCap({ model: 'deepseek-reasoner' }), false);
assert.equal(
  supportsOpenAIOutputCap({
    model: 'qwen-plus',
    includeThinkingParam: true,
    enable_thinking: true,
  }),
  false,
  'Thinking output must not be capped',
);
assert.deepEqual(getGeminiOutputConfig('gemini-2.5-flash', 85), {
  maxOutputTokens: 85,
  thinkingConfig: { thinkingBudget: 0 },
});
assert.equal(getGeminiOutputConfig('gemini-2.5-pro', 85), null);

assert.equal(
  countTranslationUnits('Привет мир, как дела'),
  4,
  'Cyrillic words count towards the replacement limit',
);
assert.equal(countTranslationUnits('The quick brown fox'), 4);
assert.equal(calculateReplacementLimit('12 345 678', 0.3), 0);

class CompletionProvider extends BaseProvider {
  constructor(answer) {
    super({ apiKey: 'key', apiEndpoint: 'https://example.test', model: 'm' });
    this.answer = answer;
    this.requests = [];
  }
  getProviderName() {
    return 'Completion';
  }
  async requestCompletion(request) {
    this.requests.push(request);
    return typeof this.answer === 'function'
      ? this.answer(request)
      : this.answer;
  }
}

const capped = new CompletionProvider({
  text: 'quick||schnell\nbrown||braun\nfox||Fu',
  truncated: true,
});
const cappedResult = await capped.analyzeFullText(
  'The quick brown fox jumps over the lazy dog.',
  settings,
);
assert.equal(capped.requests[0].maxOutputTokens, 3 * 15 + 40);
assert.match(capped.requests[0].userPrompt, /at most 3 lines/);
assert.deepEqual(
  cappedResult.replacements.map((r) => r.translation),
  ['schnell', 'braun'],
  'The cut-off last line of a truncated answer is dropped',
);

const emptyAnswer = new CompletionProvider({ text: '' });
assert.equal(
  (await emptyAnswer.analyzeFullText('The quick brown fox.', settings)).status,
  'empty',
);
const numbersOnly = new CompletionProvider({ text: 'x||y' });
await numbersOnly.analyzeFullText('12 345 678', settings);
assert.equal(
  numbersOnly.requests.length,
  0,
  'No request when nothing can be replaced',
);

let budgetEngineCalls = 0;
const budgetEngine = {
  ...errorEngine,
  replaceText: async (text) => {
    budgetEngineCalls++;
    return { original: text, processed: '', replacements: [], status: 'empty' };
  },
};
await new ProcessingCoordinator().processSegments(
  [makeSegment('budget-1', 'An exhausted budget skips this request.')],
  budgetEngine,
  0,
  'after',
  true,
  false,
  ReplacementBudget.fromText('', 0.3),
);
assert.equal(
  budgetEngineCalls,
  0,
  'No request once the page budget is exhausted',
);

// ---------- eq7.3: batching ----------

const numbered = StructuredTextParser.parseNumbered(
  [
    '```',
    '1|quick||schnell',
    '1|fox||Fuchs',
    '2|-',
    '<4>|dog||Hund',
    '9|out||of range',
    'stray line without number',
    '3 garbage',
    '```',
  ].join('\n'),
  4,
);
assert.deepEqual(numbered.items.get(1), [
  { original: 'quick', translation: 'schnell' },
  { original: 'fox', translation: 'Fuchs' },
]);
assert.deepEqual(
  numbered.items.get(2),
  [],
  '"n|-" marks an answered empty item',
);
assert.equal(numbered.items.has(3), false, 'Unanswered items are missing');
assert.deepEqual(numbered.items.get(4), [
  { original: 'dog', translation: 'Hund' },
]);
assert.equal(
  numbered.ignoredLines,
  3,
  'Out-of-range and unnumbered lines are ignored',
);
assert.equal(StructuredTextParser.parseNumbered('', 3).items.size, 0);

const { chunkBatchItems, BatchTranslationExecutor } = await import(
  '../src/modules/core/translation/BatchTranslationExecutor.ts'
);
const sized = (n) => ({ text: 'x'.repeat(n) });
assert.deepEqual(
  chunkBatchItems([sized(10), sized(10), sized(10)], 2, 1000).map(
    (c) => c.length,
  ),
  [2, 1],
  'Chunks respect the item limit',
);
assert.deepEqual(
  chunkBatchItems(
    [sized(600), sized(600), sized(3000), sized(10)],
    8,
    1000,
  ).map((c) => c.length),
  [1, 1, 1, 1],
  'Chunks respect the character limit; an oversized item gets its own request',
);

const batchProvider = new CompletionProvider((request) => ({
  text: '1|quick||schnell\n3|-',
  request,
}));
const batchAnswer = await batchProvider.analyzeBatch(
  [
    'The quick brown fox jumps over the lazy dog.',
    '42 17 99',
    'A second sentence that the model forgot.',
    'A third sentence without any pick.',
  ],
  settings,
);
assert.equal(batchProvider.requests.length, 1, 'One request carries the batch');
assert.match(
  batchProvider.requests[0].userPrompt,
  /^<1 max=3>The quick brown fox/,
);
assert.match(
  batchProvider.requests[0].userPrompt,
  /<2 max=\d+>A second sentence/,
);
assert.ok(
  !batchProvider.requests[0].userPrompt.includes('42 17 99'),
  'Items that cannot get replacements are not sent',
);
assert.ok(batchProvider.requests[0].maxOutputTokens > 0);
assert.equal(batchAnswer.status, 'ok');
assert.deepEqual(
  batchAnswer.items[0].replacements.map((r) => [r.original, r.position.start]),
  [['quick', 4]],
);
assert.equal(batchAnswer.items[1].status, 'empty');
assert.equal(
  batchAnswer.items[2],
  undefined,
  'A forgotten item is reported as missing',
);
assert.equal(batchAnswer.items[3].status, 'empty');

const okPair = (original, translation) => ({
  status: 'ok',
  pairs: [{ original, translation }],
});
const answerFor = (text, translation) => ({
  original: text,
  processed: '',
  replacements: [
    {
      original: text.split(' ')[0],
      translation,
      position: { start: 0, end: text.split(' ')[0].length },
      isNew: true,
    },
  ],
});

const makeBackend = (manyImpl) => {
  const backend = {
    oneCalls: [],
    manyCalls: [],
    translateOne: async (text) => {
      backend.oneCalls.push(text);
      return okPair(text.split(' ')[0], 'single');
    },
    translateMany: async (texts) => {
      backend.manyCalls.push(texts);
      return manyImpl(texts);
    },
  };
  return backend;
};
const keyFor = (text) => normalizeSegmentText(text);

const executorCache = new SegmentTranslationCache(50);
executorCache.track('Cached text', Promise.resolve(okPair('Cached', 'cached')));
await Promise.resolve();
await Promise.resolve();
const missingBackend = makeBackend((texts) => ({
  status: 'ok',
  items: texts.map((text, index) =>
    index === 1 ? undefined : answerFor(text, `batch-${index}`),
  ),
}));
const batchTexts = [
  'Alpha one',
  'Beta two',
  'Alpha  one',
  'Cached text',
  'Gamma three',
];
const outcomes = await new BatchTranslationExecutor(
  executorCache,
  missingBackend,
  {
    maxItems: 8,
    maxChars: 2500,
  },
).translate(batchTexts, batchTexts.map(keyFor));
assert.deepEqual(
  missingBackend.manyCalls,
  [['Alpha one', 'Beta two', 'Gamma three']],
  'Duplicates and cached segments are not sent; unique ones share one request',
);
assert.deepEqual(
  missingBackend.oneCalls,
  ['Beta two'],
  'Missing items fall back to a single request',
);
assert.deepEqual(
  outcomes.map((outcome) => outcome.pairs[0].translation),
  ['batch-0', 'single', 'batch-0', 'cached', 'batch-2'],
);
assert.equal(
  executorCache.get(keyFor('Gamma three'))?.pairs[0].translation,
  'batch-2',
  'Batch answers fill the cache per item',
);

const failingBackend = makeBackend(() => ({
  status: 'error',
  error: 'API request failed: 500 Internal Server Error',
  items: [],
}));
await new BatchTranslationExecutor(
  new SegmentTranslationCache(10),
  failingBackend,
  {
    maxItems: 8,
    maxChars: 2500,
  },
).translate(['One a', 'Two b'], ['k1', 'k2']);
assert.deepEqual(
  failingBackend.oneCalls,
  ['One a', 'Two b'],
  'A failed batch falls back to single requests',
);

const rateLimitedBackend = makeBackend(() => ({
  status: 'error',
  error: 'API request failed: 429 Too Many Requests',
  items: [],
}));
const rateLimitedCache = new SegmentTranslationCache(10);
const rateLimited = await new BatchTranslationExecutor(
  rateLimitedCache,
  rateLimitedBackend,
  {
    maxItems: 8,
    maxChars: 2500,
  },
).translate(['One a', 'Two b'], ['k1', 'k2']);
assert.equal(
  rateLimitedBackend.oneCalls.length,
  0,
  'A rate-limited batch is not multiplied into single requests',
);
assert.deepEqual(
  rateLimited.map((o) => o.status),
  ['error', 'error'],
);
assert.equal(rateLimitedCache.size, 0, 'Failed batch items are not cached');

// The coordinator hands a whole wave to replaceTexts and still applies results in segment order.
const waveCalls = [];
const waveEngine = {
  ...errorEngine,
  replaceText: async () => {
    throw new Error('single path must not be used');
  },
  replaceTexts: async (texts) => {
    waveCalls.push(texts);
    return texts.map((text) => ({
      original: text,
      processed: '',
      replacements: [
        {
          original: 'Budget',
          translation: 'Budget-DE',
          position: { start: 0, end: 6 },
          isNew: true,
        },
      ],
      status: 'ok',
    }));
  },
};
const waveSegments = [
  makeSegment('wave-1', 'Budget first segment text.'),
  makeSegment('wave-2', 'Budget second segment text.'),
  makeSegment('wave-3', 'Budget third segment text.'),
];
const waveBudget = ReplacementBudget.fromText('one two three', 0.5);
assert.equal(waveBudget.getRemainingCount(), 2);
// linkedom has no Range support, so record DOM writes instead of performing them.
const waveCoordinator = new ProcessingCoordinator();
const appliedTo = [];
waveCoordinator.applyReplacements = (segment, replacements) => {
  appliedTo.push([segment.id, replacements.length]);
  return replacements.length;
};
const waveRun = await waveCoordinator.processSegments(
  waveSegments,
  waveEngine,
  0,
  'after',
  true,
  false,
  waveBudget,
);
assert.equal(waveCalls.length, 1, 'One wave, one replaceTexts call');
assert.equal(waveCalls[0].length, 3);
assert.equal(waveRun.success, true);
assert.equal(waveRun.replacementCount, 2, 'The page budget caps the wave');
assert.deepEqual(
  appliedTo,
  [
    ['wave-1', 1],
    ['wave-2', 1],
  ],
  'Budget is consumed and DOM writes happen in segment order',
);

console.log('api cost regression passed');
