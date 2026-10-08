import { SKIP_TAGS } from '../shared/constants';

const EXTENSION_RESULT_SELECTOR = [
  '.wxt-translation-term',
  '.wxt-original-word',
  '.wxt-pronunciation-tooltip',
  '.wxt-word-tooltip',
  '.wxt-interactive-word',
  '.wxt-phonetic-text',
  '.wxt-phonetic-loading',
  '.wxt-meaning-container',
  '.wxt-meaning-text',
  '.wxt-meaning-loading',
  '.wxt-audio-btn',
  '.wxt-accent-audio-btn',
  '.wxt-tts-button',
  '.wxt-floating-ball',
  '.wxt-floating-panel',
  '.wxt-processing',
  '.illa-paragraph-translation',
  '.illa-paragraph-loading',
].join(',');

const PROCESSED_ATTRIBUTES = [
  'data-wxt-text-processed',
  'data-wxt-word-processed',
  'data-pronunciation-added',
];

export function isHTMLElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE && 'tagName' in node;
}

export function isProcessingResultNode(node: Node): boolean {
  if (!isHTMLElement(node)) {
    return false;
  }

  return isExtensionOwnedElement(node) || hasProcessedAttribute(node);
}

/**
 * Cheap check for MutationObserver callbacks: is this element itself an
 * extension-owned node or marked as processed? Unlike isProcessingResultNode it
 * never walks ancestors (no closest()).
 */
export function isOwnedOrProcessedElement(element: Element): boolean {
  return (
    isExtensionOwnedElement(element, false) || hasProcessedAttribute(element)
  );
}

/**
 * Computed style values the DOM pipeline needs. Reading them once per element
 * and caching the result avoids repeated style recalculation during a walk.
 */
export interface StyleSnapshot {
  display: string;
  visibility: string;
}

/**
 * Per-walk memo of style reads and skip decisions. It must not outlive a
 * single walk: styles and attributes can change between walks.
 */
export interface DomPolicyCache {
  styles: WeakMap<Element, StyleSnapshot | null>;
  skip: WeakMap<Element, boolean>;
}

export function createDomPolicyCache(): DomPolicyCache {
  return { styles: new WeakMap(), skip: new WeakMap() };
}

export function getStyleSnapshot(
  element: Element,
  cache?: DomPolicyCache,
): StyleSnapshot | null {
  if (cache?.styles.has(element)) {
    return cache.styles.get(element) ?? null;
  }

  const view =
    element.ownerDocument?.defaultView ??
    (typeof window !== 'undefined' ? window : null);
  const style = view?.getComputedStyle?.(element);
  const snapshot = style
    ? { display: style.display ?? '', visibility: style.visibility ?? '' }
    : null;
  cache?.styles.set(element, snapshot);
  return snapshot;
}

export function shouldSkipSubtree(element: Element): boolean {
  return evaluateSkip(element, undefined, true);
}

/**
 * Memoized variant of shouldSkipSubtree for tree walks.
 *
 * When `ancestorsVerified` is true the caller guarantees that every ancestor of
 * `element` has already been checked and was not skipped, so the
 * extension-ownership test only looks at the element itself instead of running
 * closest() up to the document root.
 */
export function shouldSkipSubtreeCached(
  element: Element,
  cache: DomPolicyCache,
  ancestorsVerified: boolean,
): boolean {
  const cached = cache.skip.get(element);
  if (cached !== undefined) {
    return cached;
  }

  const result = evaluateSkip(element, cache, !ancestorsVerified);
  cache.skip.set(element, result);
  return result;
}

function evaluateSkip(
  element: Element,
  cache: DomPolicyCache | undefined,
  checkAncestors: boolean,
): boolean {
  if (SKIP_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }

  if (element.getAttribute('aria-hidden') === 'true') {
    return true;
  }

  if (element.hasAttribute('inert')) {
    return true;
  }

  if (
    isExtensionOwnedElement(element, checkAncestors) ||
    hasProcessedAttribute(element)
  ) {
    return true;
  }

  if ((element as HTMLElement).isContentEditable) {
    return true;
  }

  // Style reads come last: they are the only checks that can force a style
  // recalculation.
  return isHiddenElement(element, cache);
}

export function isTranslatableTextNode(
  node: Text,
  boundary?: Element,
): boolean {
  if (!node.textContent?.trim()) {
    return false;
  }

  // Every ancestor up to the boundary is checked individually, so only the
  // boundary needs closest() to cover the ancestors above it.
  let parent = node.parentElement;
  while (parent) {
    const isBoundary = parent === boundary;
    if (evaluateSkip(parent, undefined, isBoundary)) {
      return false;
    }

    if (isBoundary) {
      break;
    }

    parent = parent.parentElement;
  }

  return true;
}

export function isTranslationCandidateNode(
  node: Node,
  minTextLength = 1,
): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? '';
    return text.length >= minTextLength && isTranslatableTextNode(node as Text);
  }

  if (!isHTMLElement(node) || shouldSkipSubtree(node)) {
    return false;
  }

  const text = node.textContent?.trim() ?? '';
  return text.length >= minTextLength && !isMostlyPunctuation(text);
}

function isExtensionOwnedElement(
  element: Element,
  checkAncestors = true,
): boolean {
  if (element.tagName.toLowerCase() === 'wxt-floating-menu') {
    return true;
  }

  if (!checkAncestors) {
    return Boolean(element.matches?.(EXTENSION_RESULT_SELECTOR));
  }

  return Boolean(
    element.matches?.(EXTENSION_RESULT_SELECTOR) ||
      element.closest?.(EXTENSION_RESULT_SELECTOR),
  );
}

function hasProcessedAttribute(element: Element): boolean {
  return PROCESSED_ATTRIBUTES.some((attr) => element.hasAttribute(attr));
}

function isHiddenElement(element: Element, cache?: DomPolicyCache): boolean {
  if (element.hasAttribute('hidden')) {
    return true;
  }

  const style = getStyleSnapshot(element, cache);
  if (!style) {
    return false;
  }

  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse'
  );
}

function isMostlyPunctuation(text: string): boolean {
  return /^[\d\s.,!?\-+=()[\]{}:;'"\uff0c\u3002\uff01\uff1f\u3001\uff08\uff09\u3010\u3011\u300a\u300b]+$/.test(
    text,
  );
}
