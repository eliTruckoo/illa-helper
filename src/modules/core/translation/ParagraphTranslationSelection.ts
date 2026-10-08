import type { ParagraphInfo } from '../../processing/DomWalker';
import { PARAGRAPH_TRANSLATION } from '../../shared/constants';

const SHORT_INLINE_TEXT_MAX_LENGTH = 20;
const INLINE_LINK_ITEM_MAX_LENGTH = 40;

export function selectParagraphTranslationElements(
  paragraphs: ParagraphInfo[],
): HTMLElement[] {
  const orderedElements = paragraphs.map((paragraph) => paragraph.element);
  const selected = new Set<HTMLElement>();

  for (let index = 0; index < orderedElements.length; index++) {
    const element = orderedElements[index];
    if (selected.has(element)) continue;
    if (hasParagraphTranslation(element)) continue;
    if (hasParagraphTranslationAncestor(element)) continue;
    if (hasParagraphTranslationSibling(element)) continue;

    const inlineItemChildren = findInlineItemChildren(element);
    if (inlineItemChildren.length > 0) {
      inlineItemChildren.forEach((child) => selected.add(child));
      continue;
    }

    const shortInlineChild = findShortInlineOnlyChild(
      element,
      orderedElements,
      index,
    );
    if (shortInlineChild) {
      selected.add(shortInlineChild);
      continue;
    }

    if (!hasSelectedAncestor(element, selected)) {
      selected.add(element);
    }
  }

  return orderedElements.filter((element) => selected.has(element));
}

function hasSelectedAncestor(
  element: HTMLElement,
  selected: Set<HTMLElement>,
): boolean {
  let current = element.parentElement;
  while (current) {
    if (selected.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function hasParagraphTranslation(element: HTMLElement): boolean {
  return Boolean(
    element.matches(`.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`) ||
      element.querySelector(`.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`),
  );
}

function hasParagraphTranslationAncestor(element: HTMLElement): boolean {
  return Boolean(
    element.parentElement?.closest(`.${PARAGRAPH_TRANSLATION.WRAPPER_CLASS}`),
  );
}

function hasParagraphTranslationSibling(element: HTMLElement): boolean {
  const nextSibling = element.nextSibling;
  return (
    nextSibling?.nodeType === Node.ELEMENT_NODE &&
    (nextSibling as HTMLElement).classList.contains(
      PARAGRAPH_TRANSLATION.WRAPPER_CLASS,
    )
  );
}

/**
 * `candidates` are in document (pre-)order, so the descendants of the element
 * at `index` are exactly the candidates directly following it. Scanning stops
 * at the first non-descendant (or the second descendant) instead of testing
 * every candidate, which made selection O(P^2).
 */
function findShortInlineOnlyChild(
  element: HTMLElement,
  candidates: HTMLElement[],
  index: number,
): HTMLElement | null {
  if (isInlineCandidate(element)) return null;

  let child: HTMLElement | null = null;
  for (let next = index + 1; next < candidates.length; next++) {
    const candidate = candidates[next];
    if (candidate === element) continue;
    if (!element.contains(candidate)) break;
    if (child) return null; // more than one descendant candidate
    child = candidate;
  }
  if (!child) return null;

  const text = element.textContent?.trim() ?? '';
  if (text.length === 0 || text.length > SHORT_INLINE_TEXT_MAX_LENGTH) {
    return null;
  }

  return isInlineCandidate(child) ? child : null;
}

function findInlineItemChildren(element: HTMLElement): HTMLElement[] {
  if (hasMeaningfulOwnText(element)) return [];

  const childElements = Array.from(element.children) as HTMLElement[];
  if (childElements.length < 2) return [];

  const linkChildren: HTMLElement[] = [];
  for (const child of childElements) {
    if (!hasMeaningfulText(child)) continue;

    if (!isInlineCandidate(child) || !isShortTextItem(child)) {
      return [];
    }

    linkChildren.push(child);
  }

  return linkChildren.length >= 2 ? linkChildren : [];
}

function hasMeaningfulOwnText(element: HTMLElement): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

function isShortTextItem(element: HTMLElement): boolean {
  const text = element.textContent?.trim() ?? '';
  return text.length > 0 && text.length <= INLINE_LINK_ITEM_MAX_LENGTH;
}

function hasMeaningfulText(element: HTMLElement): boolean {
  return Boolean(element.textContent?.trim());
}

function isInlineCandidate(element: HTMLElement): boolean {
  if (element.tagName === 'A' || element.tagName === 'SPAN') return true;

  const display = window.getComputedStyle(element).display;
  if (!display) return false;

  return display === 'contents' || display.includes('inline');
}
