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
    return this.impl(text);
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

console.log('api cost regression passed');
