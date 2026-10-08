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

console.log('main regression passed');
