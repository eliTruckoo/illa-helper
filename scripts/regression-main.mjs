import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML(`
  <!doctype html>
  <html>
  <body class="wxt-translation-hidden">
    <nav id="tabs" role="tablist">
      <a id="tab-guides" role="tab" href="/guides">Guides</a>
      <a id="tab-reference" role="tab" href="/reference">Reference</a>
      <a id="tab-community" role="tab" href="/community">Community</a>
    </nav>
    <nav id="plain-nav">Docs Blog Careers</nav>
    <article>
      <p id="article">
        The Ankara Summit may be
        <a id="remembered" href="https://example.com">remembered</a>
        as a <em id="turning-point">multipolar turning point</em>.
      </p>
      <div id="card" role="button">
        <span id="card-copy">Build production-grade applications with Spring.</span>
      </div>
      <button id="real-button">This real button should not be translated.</button>
      <pre id="pre">const ignored = true;</pre>
      <code id="code">inlineCodeShouldNotTranslate</code>
    </article>
  </body>
  </html>
`);

window.setTimeout = setTimeout;
window.clearTimeout = clearTimeout;
window.getComputedStyle = (element) => ({
  display:
    element.getAttribute?.('data-display') ??
    (['A', 'SPAN', 'EM', 'STRONG', 'B', 'I'].includes(element.tagName)
      ? 'inline'
      : 'block'),
  visibility: element.getAttribute?.('data-visibility') ?? 'visible',
});

globalThis.window = window;
globalThis.document = document;
globalThis.Node = window.Node;
globalThis.Text = window.Text;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.SVGElement = window.SVGElement;
globalThis.NodeFilter = {
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  SHOW_TEXT: 4,
};
globalThis.browser = {
  runtime: {
    id: 'regression-main-extension',
    onMessage: {
      addListener: () => undefined,
    },
    sendMessage: async () => true,
  },
  storage: {
    sync: {
      get: async () => ({}),
      set: async () => undefined,
    },
  },
};

const originalCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {},
});

const { isTranslationCandidateNode } = await import(
  '../src/modules/processing/DomTranslationPolicy.ts'
);
const { walkAndCollectParagraphs } = await import(
  '../src/modules/processing/DomWalker.ts'
);
const { selectParagraphTranslationElements } = await import(
  '../src/modules/core/translation/ParagraphTranslationSelection.ts'
);
const { renderParagraphTranslation } = await import(
  '../src/modules/core/translation/ParagraphTranslationRenderer.ts'
);

assert.equal(
  isTranslationCandidateNode(document.querySelector('#real-button'), 1),
  false,
  'A real button tag still must not enter the translation queue',
);
assert.equal(
  isTranslationCandidateNode(document.querySelector('#pre'), 1),
  false,
  'pre code blocks must not enter the translation queue',
);
assert.equal(
  isTranslationCandidateNode(document.querySelector('#tabs'), 1),
  true,
  'ARIA role must no longer wrongly exclude an entire subtree of visible text',
);
assert.equal(
  isTranslationCandidateNode(document.querySelector('#card'), 16),
  true,
  'Body cards with role=button should be allowed into the translation queue',
);

const selected = selectParagraphTranslationElements(
  walkAndCollectParagraphs(document.body),
);
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: originalCrypto,
});

assert.deepEqual(
  selected.map((element) => element.id),
  [
    'tab-guides',
    'tab-reference',
    'tab-community',
    'plain-nav',
    'article',
    'card',
  ],
  'Paragraph selection should cover navigation, regular paragraphs, and body text without p tags, without over-filtering',
);

const article = document.querySelector('#article');
renderParagraphTranslation(
  article,
  'The Ankara summit may be seen as a multipolar turning point.',
  'wxt-style-default',
);

const paragraphTranslation = article.querySelector(
  '.illa-paragraph-translation',
);
assert.equal(
  paragraphTranslation?.tagName,
  'SPAN',
  'The p translation should be attached inside the p, avoiding a sibling node that breaks the layout',
);
assert.match(
  paragraphTranslation?.getAttribute('style') ?? '',
  /display:\s*block/,
  'The p translation must be displayed on its own line',
);

const tab = document.querySelector('#tab-guides');
renderParagraphTranslation(tab, 'Guides', 'wxt-style-default');
assert.equal(
  tab.querySelector('.illa-paragraph-translation')?.tagName,
  'SPAN',
  'The translation of a short inline nav item should be attached inside the original element',
);

await import('./regression-api-cost.mjs');

// ------------------------------------------------------------
// DomWalker: single-pass walk must match the original algorithm
// ------------------------------------------------------------

const { walkAndCollectParagraphsAsync, extractTextFromNode, isInlineElement } =
  await import('../src/modules/processing/DomWalker.ts');
const { shouldSkipSubtree, isTranslatableTextNode, isHTMLElement } =
  await import('../src/modules/processing/DomTranslationPolicy.ts');
const { ATOMIC_INLINE_TAGS } = await import(
  '../src/modules/shared/constants.ts'
);

/** Reference implementation of the original attribute-labelling walker. */
function referenceWalk(root) {
  const P = 'data-ref-paragraph';
  const B = 'data-ref-block';
  const labelled = [];
  const walk = (element) => {
    if (ATOMIC_INLINE_TAGS.has(element.tagName)) return true;
    if (shouldSkipSubtree(element)) return false;
    let hasInlineChild = false;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent?.trim()) hasInlineChild = true;
      } else if (isHTMLElement(child) && walk(child)) {
        hasInlineChild = true;
      }
    }
    if (hasInlineChild) element.setAttribute(P, '');
    const inline = isInlineElement(element);
    if (!inline) element.setAttribute(B, '');
    labelled.push(element);
    return inline;
  };
  walk(root);

  const candidates = [
    ...(root.hasAttribute(P) ? [root] : []),
    ...root.querySelectorAll(`[${P}]`),
  ];
  const result = [];
  for (const element of candidates) {
    const children = [...element.querySelectorAll(`[${P}]`)];
    if (children.some((child) => child.hasAttribute(B))) continue;
    const textContent = extractTextFromNode(element);
    if (textContent.trim().length < 2) continue;
    const textNodes = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (isTranslatableTextNode(child, element)) textNodes.push(child);
        } else {
          visit(child);
        }
      }
    };
    visit(element);
    if (textNodes.length === 0) continue;
    result.push({ element, textContent, textNodes });
  }
  labelled.forEach((element) => {
    element.removeAttribute(P);
    element.removeAttribute(B);
  });
  return result;
}

const walkerFixture = document.createElement('section');
walkerFixture.id = 'walker-fixture';
walkerFixture.innerHTML = `
  <div id="w-mixed">Lead text <p id="w-inner-p">Inner block paragraph text.</p></div>
  <p id="w-nested">Read the <a id="w-long-link" href="#">very long link text inside a paragraph</a> and <strong>bold</strong> words<br>next line <time id="w-time">2024-01-01</time>.</p>
  <ul id="w-list"><li id="w-li-1"><a href="#">Home</a></li><li id="w-li-2"><a href="#">About us</a></li></ul>
  <div id="w-hidden" data-display="none"><p>Hidden paragraph text</p></div>
  <div id="w-vis" data-visibility="hidden"><p>Invisible paragraph text</p></div>
  <p id="w-aria">Visible <span aria-hidden="true">aria hidden text</span> tail text</p>
  <div id="w-inline-block"><span data-display="inline-block"><div id="w-deep">Deep block text</div></span> after</div>
  <p id="w-own"><span class="wxt-translation-term">owned</span> plain text after term</p>
  <p id="w-processed" data-wxt-text-processed="true">Already processed text</p>
  <div id="w-script">Script sibling text<script>var ignored = 1;</script></div>
  <p id="w-abbr"><abbr title="x">HTML</abbr></p>
  <div id="w-empty-inline"><span> </span><em>emphasis only</em></div>
  <div id="w-contents" data-display="contents">Contents display text</div>
`;
document.body.appendChild(walkerFixture);

const describe = (paragraphs) =>
  paragraphs.map((p) => ({
    id: p.element.id || p.element.tagName,
    text: p.textContent,
    nodes: p.textNodes.map((node) => node.textContent),
  }));

const expectedParagraphs = referenceWalk(walkerFixture);
assert.ok(
  expectedParagraphs.length >= 10,
  'walker fixture should exercise many paragraph shapes',
);
const syncParagraphs = walkAndCollectParagraphs(walkerFixture);
assert.deepEqual(
  describe(syncParagraphs),
  describe(expectedParagraphs),
  'single-pass DomWalker must return the same paragraphs as the original walker',
);
syncParagraphs.forEach((paragraph, index) => {
  assert.equal(paragraph.element, expectedParagraphs[index].element);
  assert.deepEqual(paragraph.textNodes, expectedParagraphs[index].textNodes);
});
assert.equal(
  walkerFixture.querySelectorAll(
    '[data-illa-walked], [data-illa-paragraph], [data-illa-block], [data-illa-inline]',
  ).length,
  0,
  'the walk must not write label attributes into the page DOM',
);

const asyncParagraphs = await walkAndCollectParagraphsAsync(walkerFixture, {
  sliceMs: 0,
});
assert.deepEqual(
  describe(asyncParagraphs),
  describe(expectedParagraphs),
  'time-sliced walk must produce the same paragraphs as the synchronous walk',
);

const bodyReference = describe(referenceWalk(document.body));
assert.deepEqual(
  describe(walkAndCollectParagraphs(document.body)),
  bodyReference,
  'single-pass DomWalker must match the original walker on the whole page',
);

// ------------------------------------------------------------
// ProcessingStateManager: identity keys and bounded fingerprint store
// ------------------------------------------------------------

window.setInterval = () => 0;
window.clearInterval = () => undefined;

const { ProcessingStateManager } = await import(
  '../src/modules/processing/ProcessingStateManager.ts'
);
const stateManager = new ProcessingStateManager();
const sameTextA = document.createElement('p');
const sameTextB = document.createElement('p');
assert.equal(
  stateManager.generateDomPath(sameTextA),
  stateManager.generateDomPath(sameTextA),
  'the same element must always get the same identity key',
);
assert.notEqual(
  stateManager.generateContentFingerprint(
    'Same text',
    stateManager.generateDomPath(sameTextA),
  ),
  stateManager.generateContentFingerprint(
    'Same text',
    stateManager.generateDomPath(sameTextB),
  ),
  'the same text in a different element must get a different fingerprint',
);
for (let i = 0; i <= 5000; i++) {
  stateManager.markProcessingComplete(`fp-${i}`, 'p#1', 0);
}
assert.equal(
  stateManager.getProcessingStats().processedCount,
  5000,
  'the processed fingerprint store must be capped',
);
assert.equal(stateManager.isContentProcessed('fp-0'), false);
assert.equal(stateManager.isContentProcessed('fp-5000'), true);
stateManager.destroy();

// ------------------------------------------------------------
// ContentSegmenter: every text node belongs to at most one segment
// ------------------------------------------------------------

const { ContentSegmenter } = await import(
  '../src/modules/processing/ContentSegmenter.ts'
);
const segmentFixture = document.createElement('section');
segmentFixture.innerHTML = `
  <p id="s-nested">This paragraph contains <a id="s-link" href="#">a rather long hyperlink text here</a> and more trailing words.</p>
  <p id="s-long">${Array.from({ length: 12 }, (_, i) => `<span>Sentence number ${i} is part of a long paragraph.</span>`).join(' ')}</p>
`;
document.body.appendChild(segmentFixture);

const segments = await new ContentSegmenter({
  maxSegmentLength: 200,
}).segmentContent(segmentFixture);
const seenTextNodes = new Set();
for (const segment of segments) {
  for (const node of segment.textNodes) {
    assert.ok(
      !seenTextNodes.has(node),
      `text node "${node.textContent}" must not appear in two segments`,
    );
    seenTextNodes.add(node);
  }
}
assert.ok(
  !segments.some((segment) => segment.element.id === 's-link'),
  'a nested inline paragraph must not become its own segment',
);
const longSegments = segments.filter(
  (segment) => segment.element.id === 's-long',
);
assert.ok(longSegments.length > 1, 'a long paragraph must be split');
assert.equal(
  new Set(longSegments.map((segment) => segment.fingerprint)).size,
  longSegments.length,
  'split sub-segments of one element must have distinct fingerprints',
);

// ------------------------------------------------------------
// LanguageService: cheap, cached page language detection
// ------------------------------------------------------------

let detectLanguageCalls = 0;
globalThis.browser.i18n = {
  detectLanguage: async () => {
    detectLanguageCalls++;
    return { languages: [{ language: 'fr' }] };
  },
};
const { languageService } = await import(
  '../src/modules/core/translation/LanguageService.ts'
);
document.documentElement.setAttribute('lang', 'de-AT');
languageService.invalidatePageLanguage();
assert.equal(
  await languageService.detectPageLanguage(),
  'de',
  '<html lang> must be used first',
);
document.documentElement.setAttribute('lang', 'es');
assert.equal(
  await languageService.detectPageLanguage(),
  'de',
  'the page language must be cached for the same page',
);
document.documentElement.removeAttribute('lang');
languageService.invalidatePageLanguage();
assert.equal(await languageService.detectPageLanguage(), 'fr');
await languageService.detectPageLanguage();
assert.equal(
  detectLanguageCalls,
  1,
  'text-sample detection must run once per page',
);

// ------------------------------------------------------------
// Paragraph mode: selection and per-page result cache
// ------------------------------------------------------------

const selectionFixture = document.createElement('section');
selectionFixture.innerHTML = `
  <ul><li id="sel-li"><a id="sel-a" href="#">Short</a></li></ul>
  <div id="sel-two"><a href="#">First link item</a> text <a href="#">Second link item</a></div>
`;
document.body.appendChild(selectionFixture);
assert.deepEqual(
  selectParagraphTranslationElements(
    walkAndCollectParagraphs(selectionFixture),
  ).map((element) => element.id),
  ['sel-a', 'sel-two'],
  'a short block with exactly one inline candidate selects the inline child',
);

const { ParagraphTranslationApi } = await import(
  '../src/modules/core/translation/ParagraphTranslationApi.ts'
);
const paragraphApi = ParagraphTranslationApi.getInstance();
const requested = [];
paragraphApi.requestTranslation = async (text) => {
  requested.push(text);
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (text.startsWith('fail')) throw new Error('api down');
  return `de:${text}`;
};
const paragraphSettings = {
  activeApiConfigId: 'cfg',
  apiConfigs: [{ id: 'cfg', config: { model: 'model-a' } }],
  multilingualConfig: { targetLanguage: 'de', nativeLanguage: 'en' },
};
const context = { settings: paragraphSettings };
const [first, second] = await Promise.all([
  paragraphApi.translateParagraph('Hello  world', 'de', context),
  paragraphApi.translateParagraph('Hello world', 'de', context),
]);
assert.equal(first, 'de:Hello  world');
assert.equal(second, first, 'concurrent identical paragraphs share a request');
await paragraphApi.translateParagraph('Hello world', 'de', context);
assert.equal(requested.length, 1, 'repeated paragraphs are served from cache');
await paragraphApi.translateParagraph('Hello world', 'fr', context);
assert.equal(requested.length, 2, 'the target language is part of the key');
const originalConsoleError = console.error;
console.error = () => undefined;
await assert.rejects(
  paragraphApi.translateParagraph('fail once', 'de', context),
);
await assert.rejects(
  paragraphApi.translateParagraph('fail once', 'de', context),
);
console.error = originalConsoleError;
assert.equal(requested.length, 4, 'failures must never be cached');

// ------------------------------------------------------------
// Mutation batching: debounce with maxWait
// ------------------------------------------------------------

const { createBatchScheduler } = await import(
  '../src/modules/content/utils/domUtils.ts'
);

function createFakeClock() {
  let time = 0;
  let timers = [];
  let nextId = 1;
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.push({ id, at: time + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((timer) => timer.id !== id);
    },
    now: () => time,
    advanceTo(target) {
      for (;;) {
        const due = timers
          .filter((timer) => timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        time = due.at;
        due.callback();
      }
      time = target;
    },
  };
}

const clock = createFakeClock();
const flushTimes = [];
const scheduler = createBatchScheduler(
  () => flushTimes.push(clock.now()),
  { wait: 150, maxWait: 750 },
  clock,
);
scheduler.schedule();
clock.advanceTo(149);
assert.deepEqual(flushTimes, [], 'no flush before the debounce delay');
clock.advanceTo(150);
assert.deepEqual(flushTimes, [150], 'a quiet batch flushes after the delay');

for (let t = 200; t <= 1200; t += 100) {
  clock.advanceTo(t);
  scheduler.schedule();
}
assert.deepEqual(
  flushTimes,
  [150, 950],
  'continuous mutations must flush after maxWait instead of starving',
);
scheduler.cancel();
clock.advanceTo(5000);
assert.equal(flushTimes.length, 2, 'cancel drops the pending flush');

// ------------------------------------------------------------
// SegmentObserver: split paragraphs, release after processing
// ------------------------------------------------------------

const observedTargets = new Set();
let intersectionCallback;
globalThis.IntersectionObserver = class {
  constructor(callback) {
    intersectionCallback = callback;
  }
  observe(target) {
    observedTargets.add(target);
  }
  unobserve(target) {
    observedTargets.delete(target);
  }
  disconnect() {
    observedTargets.clear();
  }
};
window.innerHeight = 800;
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  top: 10000,
  bottom: 10100,
});

const { SegmentObserver } = await import(
  '../src/modules/content/utils/SegmentObserver.ts'
);
const visibleBatches = [];
const segmentObserver = new SegmentObserver((visible) => {
  if (visible.length > 0) visibleBatches.push(visible);
});
const splitElement = document.createElement('p');
document.body.appendChild(splitElement);
const splitSegments = [0, 1, 2].map((index) => ({
  id: `split-${index}`,
  textContent: `part ${index}`,
  element: splitElement,
  elements: [splitElement],
  textNodes: [],
  fingerprint: `split-fp-${index}`,
  domPath: 'p#split',
}));
segmentObserver.observeMultiple(splitSegments);
segmentObserver.observe(splitSegments[0]);
assert.equal(
  segmentObserver.getObservedCount(),
  3,
  'all sub-segments of a split paragraph must be kept (no overwrite, no duplicates)',
);
intersectionCallback([{ target: splitElement, isIntersecting: true }]);
assert.deepEqual(
  visibleBatches.at(-1).map((segment) => segment.id),
  ['split-0', 'split-1', 'split-2'],
  'an element entering the viewport reports every sub-segment',
);
segmentObserver.unobserveMultiple(splitSegments.slice(0, 2));
assert.ok(observedTargets.has(splitElement));
segmentObserver.unobserve(splitSegments[2]);
assert.equal(segmentObserver.getObservedCount(), 0);
assert.ok(
  !observedTargets.has(splitElement),
  'the element is unobserved once all its segments are processed',
);

const detachedElement = document.createElement('p');
document.body.appendChild(detachedElement);
segmentObserver.observe({ ...splitSegments[0], element: detachedElement });
detachedElement.remove();
intersectionCallback([{ target: detachedElement, isIntersecting: false }]);
assert.equal(
  segmentObserver.getObservedCount(),
  0,
  'detached elements must be released',
);
segmentObserver.destroy();

// Small segments stay separate by default (batching packs them; merging
// would defeat exact deduplication of repeated text).
const smallFixture = document.createElement('section');
smallFixture.innerHTML = `
  <p>Repeated short caption A1</p>
  <p>Repeated short caption A1</p>
`;
document.body.appendChild(smallFixture);
const smallSegments = await new ContentSegmenter().segmentContent(smallFixture);
assert.deepEqual(
  smallSegments.map((segment) => segment.textContent),
  ['Repeated short caption A1', 'Repeated short caption A1'],
  'small segments must not be merged by default',
);

// ------------------------------------------------------------
// Pronunciation: Web Speech is initialised lazily (illa-helper-ei3.5)
// ------------------------------------------------------------

let speechSynthesisAccesses = 0;
const voicesChangedListeners = new Set();
const fakeSpeechSynthesis = {
  speaking: false,
  getVoices: () => [],
  addEventListener: (type, listener) => {
    if (type === 'voiceschanged') voicesChangedListeners.add(listener);
  },
  removeEventListener: (type, listener) => {
    if (type === 'voiceschanged') voicesChangedListeners.delete(listener);
  },
  cancel: () => undefined,
  speak: (utterance) => {
    setTimeout(() => utterance.onend?.(), 0);
  },
};
Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  get() {
    speechSynthesisAccesses += 1;
    return fakeSpeechSynthesis;
  },
});
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};

const { PronunciationService } = await import(
  '../src/modules/pronunciation/services/PronunciationService.ts'
);
const pronunciationService = new PronunciationService();
pronunciationService.stopSpeaking();
pronunciationService.updateConfig({
  ttsConfig: { provider: 'web-speech', lang: 'en-GB' },
});
assert.equal(
  speechSynthesisAccesses,
  0,
  'creating, stopping and reconfiguring the pronunciation service must not touch speechSynthesis',
);

const { WebSpeechTTSProvider } = await import(
  '../src/modules/pronunciation/tts/WebSpeechTTSProvider.ts'
);
const webSpeech = new WebSpeechTTSProvider();
webSpeech.stop();
assert.equal(webSpeech.isSpeaking(), false);
assert.equal(speechSynthesisAccesses, 0, 'idle Web Speech provider stays cold');
const speakResult = await webSpeech.speak('hello');
assert.equal(speakResult.success, true);
assert.ok(speechSynthesisAccesses > 0, 'speak() initialises speech synthesis');
assert.equal(
  voicesChangedListeners.size,
  0,
  'the voiceschanged listener is removed once voice loading settles',
);
assert.equal(
  fakeSpeechSynthesis.onvoiceschanged,
  undefined,
  'the page-owned onvoiceschanged handler is never overwritten',
);
pronunciationService.destroy();

// ------------------------------------------------------------
// StorageService: in-memory settings cache (illa-helper-ei3.9)
// ------------------------------------------------------------

{
  const { StorageService } = await import(
    '../src/modules/core/storage/StorageService.ts'
  );
  const { StorageEventType } = await import(
    '../src/modules/core/storage/types.ts'
  );
  const { DEFAULT_SETTINGS } = await import(
    '../src/modules/shared/constants/defaults.ts'
  );

  const originalStorage = globalThis.browser.storage;
  const syncStore = {};
  const changeListeners = [];
  let syncGets = 0;
  let syncSets = 0;
  globalThis.browser.storage = {
    sync: {
      get: async (key) => {
        syncGets += 1;
        return key in syncStore ? { [key]: syncStore[key] } : {};
      },
      set: async (items) => {
        syncSets += 1;
        Object.assign(syncStore, items);
      },
      remove: async (key) => {
        delete syncStore[key];
      },
    },
    onChanged: {
      addListener: (listener) => changeListeners.push(listener),
    },
  };
  const emitStorageChange = (key, newValue) => {
    for (const listener of changeListeners) {
      listener({ [key]: { newValue } }, 'sync');
    }
  };

  try {
    const defaultsSnapshot = JSON.stringify(DEFAULT_SETTINGS);
    const service = new StorageService();

    // Concurrent first reads share one storage round-trip and never write
    const [first, second] = await Promise.all([
      service.getUserSettings(),
      service.getUserSettings(),
    ]);
    assert.equal(syncGets, 1, 'concurrent first reads are coalesced');
    assert.equal(syncSets, 0, 'reading defaults must not write');
    assert.notEqual(first, second, 'each caller receives its own copy');
    assert.equal(changeListeners.length, 1, 'one storage.onChanged listener');

    // Mutating a returned object must not leak into the cache or the defaults
    first.apiConfigs.push({ id: 'mutated' });
    first.multilingualConfig.targetLanguage = 'mutated';
    const third = await service.getUserSettings();
    assert.equal(syncGets, 1, 'later reads are served from memory');
    assert.equal(
      third.multilingualConfig.targetLanguage,
      DEFAULT_SETTINGS.multilingualConfig.targetLanguage,
    );
    assert.equal(
      JSON.stringify(DEFAULT_SETTINGS),
      defaultsSnapshot,
      'DEFAULT_SETTINGS must never be mutated through getUserSettings()',
    );

    // A save updates the cache (read-your-writes) and notifies subscribers
    const changedEvents = [];
    const onSettingsChanged = (event) => changedEvents.push(event.data);
    service.addEventListener(
      StorageEventType.SETTINGS_CHANGED,
      onSettingsChanged,
    );
    third.triggerMode = 'automatic';
    await service.saveUserSettings(third);
    assert.equal((await service.getUserSettings()).triggerMode, 'automatic');
    assert.equal(syncGets, 1, 'saving does not force a re-read');
    assert.equal(changedEvents.at(-1)?.triggerMode, 'automatic');

    // A write from another context invalidates via storage.onChanged
    const external = JSON.parse(syncStore.user_settings);
    external.triggerMode = 'manual';
    external.apiRequestTimeout = 12345;
    syncStore.user_settings = JSON.stringify(external);
    emitStorageChange('user_settings', syncStore.user_settings);
    assert.equal((await service.getUserSettings()).apiRequestTimeout, 12345);
    assert.equal(changedEvents.at(-1)?.apiRequestTimeout, 12345);

    // Unrelated keys and areas are ignored
    const eventsBefore = changedEvents.length;
    emitStorageChange('website_management', '{}');
    for (const listener of changeListeners) {
      listener({ user_settings: { newValue: '{}' } }, 'local');
    }
    assert.equal(changedEvents.length, eventsBefore);

    // Removing the key drops the cache; the next read goes back to storage
    delete syncStore.user_settings;
    emitStorageChange('user_settings', undefined);
    const afterRemoval = await service.getUserSettings();
    assert.equal(syncGets, 2, 'invalidated cache re-reads storage once');
    assert.equal(
      afterRemoval.apiRequestTimeout,
      DEFAULT_SETTINGS.apiRequestTimeout,
    );
    service.removeEventListener(
      StorageEventType.SETTINGS_CHANGED,
      onSettingsChanged,
    );

    // Stored data that needs normalisation is migrated exactly once
    const legacy = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    delete legacy.lazyLoading;
    const migratingService = new StorageService();
    syncStore.user_settings = JSON.stringify(legacy);
    const setsBefore = syncSets;
    await migratingService.getUserSettings();
    await migratingService.getUserSettings();
    assert.equal(syncSets - setsBefore, 1, 'normalisation writes only once');
  } finally {
    globalThis.browser.storage = originalStorage;
  }
}

// ------------------------------------------------------------
// Tooltip controller: delegated hover, no per-word registry (illa-helper-bfn.2)
// ------------------------------------------------------------

{
  const { TooltipInteractionController } = await import(
    '../src/modules/pronunciation/ui/TooltipInteractionController.ts'
  );
  const { TooltipRenderer } = await import(
    '../src/modules/pronunciation/ui/TooltipRenderer.ts'
  );
  const { DEFAULT_PRONUNCIATION_CONFIG, TIMER_CONSTANTS } = await import(
    '../src/modules/pronunciation/config/index.ts'
  );
  const { StorageService } = await import(
    '../src/modules/core/storage/StorageService.ts'
  );

  window.innerWidth = 1024;
  window.scrollX = 0;
  window.scrollY = 0;
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const meaningRequests = [];
  const controller = new TooltipInteractionController({
    getConfig: () => DEFAULT_PRONUNCIATION_CONFIG,
    phoneticProvider: {
      getPhonetic: async (word) => ({
        success: true,
        data: { word, phonetics: [{ text: `/${word}/` }] },
      }),
    },
    translationProvider: {
      getMeaning: async (word) => {
        meaningRequests.push(word);
        return { success: false, error: 'offline' };
      },
    },
    renderer: new TooltipRenderer(
      DEFAULT_PRONUNCIATION_CONFIG.uiConfig,
      'visible',
    ),
    storageService: StorageService.getInstance(),
    speakText: async () => undefined,
    speakTextWithAccent: async () => undefined,
  });

  const hoverHost = document.createElement('p');
  document.body.appendChild(hoverHost);
  const words = ['alpha', 'beta', 'gamma'].map((word) => {
    const element = document.createElement('span');
    element.textContent = word;
    const inner = document.createElement('b');
    inner.textContent = '!';
    element.appendChild(inner);
    hoverHost.appendChild(element);
    return element;
  });
  for (const element of words) {
    assert.equal(
      await controller.register(element, element.firstChild.textContent),
      true,
    );
  }
  assert.equal(
    await controller.register(words[0], 'alpha'),
    false,
    'double registration is rejected',
  );
  assert.ok(words[0].classList.contains('wxt-pronunciation-enabled'));

  const pointer = (type, target, relatedTarget = null) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
    target.dispatchEvent(event);
  };
  const visibleTooltips = () =>
    document.querySelectorAll('.wxt-pronunciation-tooltip').length;

  const key = (type, keyName) => {
    const event = new window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'key', { value: keyName });
    document.dispatchEvent(event);
  };

  // With the default hotkey, hovering alone does not open the tooltip
  pointer('mouseover', words[0]);
  await wait(TIMER_CONSTANTS.SHOW_DELAY + 50);
  assert.equal(visibleTooltips(), 0, 'the hotkey is required by default');
  pointer('mouseout', words[0], hoverHost);
  key('keydown', 'Control');

  // Hovering a child of a registered word opens exactly one tooltip
  pointer('mouseover', words[0].firstElementChild);
  await wait(TIMER_CONSTANTS.SHOW_DELAY + 50);
  assert.equal(visibleTooltips(), 1, 'hovering a word shows its tooltip');

  // Moving inside the word is not a leave
  pointer('mouseout', words[0].firstElementChild, words[0]);
  pointer('mouseover', words[0]);
  await wait(TIMER_CONSTANTS.HIDE_DELAY + 50);
  assert.equal(
    visibleTooltips(),
    1,
    'moving within the word keeps the tooltip',
  );

  // Switching words replaces the tooltip instead of stacking them
  pointer('mouseout', words[0], words[1]);
  pointer('mouseover', words[1]);
  await wait(TIMER_CONSTANTS.SHOW_DELAY + 50);
  assert.equal(visibleTooltips(), 1, 'only one main tooltip at a time');

  // A tooltip whose anchor left the DOM is dropped on the next pointer move
  words[1].remove();
  pointer('mouseover', hoverHost);
  assert.equal(visibleTooltips(), 0, 'disconnected anchors hide their tooltip');

  // Failed definitions are requested once per hover and do not throw
  assert.ok(meaningRequests.includes('alpha'));

  key('keyup', 'Control');

  // destroy() removes the delegated listeners and the word markers
  controller.destroy();
  assert.ok(!words[2].classList.contains('wxt-pronunciation-enabled'));
  pointer('mouseover', words[2]);
  await wait(TIMER_CONSTANTS.SHOW_DELAY + 50);
  assert.equal(visibleTooltips(), 0, 'no tooltips after destroy()');
  hoverHost.remove();
}

// ------------------------------------------------------------
// Styles: one main stylesheet per document, prefixed keyframes (illa-helper-ei3.10)
// ------------------------------------------------------------

{
  const { StyleManager } = await import(
    '../src/modules/styles/core/StyleManager.ts'
  );
  const { ALL_STYLES } = await import('../src/modules/styles/index.ts');

  const managers = [new StyleManager(), new StyleManager(), new StyleManager()];
  assert.equal(
    document.querySelectorAll('#wxt-main-styles').length,
    1,
    'the main stylesheet is injected once regardless of StyleManager instances',
  );
  managers[0].setCustomCSS('color: red;');
  managers[1].setCustomCSS('color: blue;');
  const customStyles = document.querySelectorAll(
    '#wxt-custom-translation-style',
  );
  assert.equal(customStyles.length, 1, 'custom CSS shares one style element');
  assert.match(customStyles[0].textContent, /blue/);

  const keyframeNames = [...ALL_STYLES.matchAll(/@keyframes\s+([\w-]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(keyframeNames.length > 0);
  for (const name of keyframeNames) {
    assert.ok(name.startsWith('wxt-'), `keyframes "${name}" must be prefixed`);
  }
  assert.ok(
    !/animation:[^;]*\bspin\b/.test(ALL_STYLES.replace(/wxt-spin/g, '')),
    'no rule references the unprefixed spin keyframes',
  );
  managers[0].cleanup();
}

// ------------------------------------------------------------
// Floating ball: callback survives disable/enable, single menu handler (illa-helper-bfn.8)
// ------------------------------------------------------------

{
  // linkedom only creates <body> for full documents, so wrap fragments
  const { DOMParser: LinkedomParser } = await import('linkedom');
  globalThis.DOMParser = class {
    parseFromString(html, type) {
      return new LinkedomParser().parseFromString(
        `<!doctype html><html><body>${html}</body></html>`,
        type,
      );
    }
  };
  const { FloatingBallManager } = await import(
    '../src/modules/floatingBall/managers/FloatingBallManager.ts'
  );
  const { DEFAULT_FLOATING_BALL_CONFIG } = await import(
    '../src/modules/shared/constants/defaults.ts'
  );

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (target) => {
    target.dispatchEvent(new window.Event('click', { bubbles: true }));
  };
  const ballRoot = () =>
    document.getElementById('illa-floating-root')?.shadowRoot;

  let translateCalls = 0;
  const enabledConfig = { ...DEFAULT_FLOATING_BALL_CONFIG, enabled: true };
  const floatingBall = new FloatingBallManager({ ...enabledConfig });
  floatingBall.init(() => {
    translateCalls += 1;
  });

  floatingBall.updateConfig({ ...enabledConfig, enabled: false });
  assert.equal(ballRoot(), undefined, 'disabling removes the floating ball');
  floatingBall.updateConfig({ ...enabledConfig });

  click(ballRoot().querySelector('.wxt-floating-ball'));
  await wait(150);
  assert.equal(
    translateCalls,
    1,
    'clicking the ball still translates after disable -> enable',
  );

  // Menu buttons trigger their action exactly once, also after closing and
  // re-showing the ball
  const panelButton = (action) =>
    [...ballRoot().querySelectorAll('.wxt-panel-btn')].find(
      (button) => button.getAttribute('data-action') === action,
    );
  const translateButton = () => panelButton('translate');
  click(translateButton());
  assert.equal(translateCalls, 2, 'menu action runs once');
  click(panelButton('close'));
  floatingBall.updateConfig({ ...enabledConfig });
  click(translateButton());
  assert.equal(translateCalls, 3, 'menu handlers are never bound twice');

  floatingBall.destroy();
  assert.equal(ballRoot(), undefined);
}

console.log('main regression passed');
