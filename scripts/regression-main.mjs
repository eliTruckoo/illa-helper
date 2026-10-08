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
  display: ['A', 'SPAN', 'EM'].includes(element.tagName) ? 'inline' : 'block',
  visibility: 'visible',
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

console.log('main regression passed');
