/**
 * DOM Walker - unified DOM traversal and marking module
 *
 * Based on the walk-label design from read-frog:
 * 1. Depth-first traversal of the DOM tree
 * 2. Determine block/inline via getComputedStyle (semantic tags are forced to block)
 * 3. Nodes containing inline children are marked as "paragraph" (the basic translation unit)
 * 4. walkId deduplication avoids concurrent conflicts and repeated traversal
 *
 * Word translation and paragraph translation share this module to obtain DOM nodes.
 */

import {
  ATOMIC_INLINE_TAGS,
  FORCE_BLOCK_TAGS,
  DOM_LABELS,
} from '../shared/constants';
import {
  isHTMLElement,
  isTranslatableTextNode,
  shouldSkipSubtree,
} from './DomTranslationPolicy';

// ============================================================
// Type definitions
// ============================================================

export interface WalkResult {
  /** Whether forced to block */
  forceBlock: boolean;
  /** Whether this is an inline node */
  isInline: boolean;
}

export interface ParagraphInfo {
  /** Paragraph element */
  element: HTMLElement;
  /** Extracted text content */
  textContent: string;
  /** Text nodes within the paragraph */
  textNodes: Text[];
}

let fallbackWalkId = 0;

function createWalkId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto);
  }

  fallbackWalkId += 1;
  return `fallback-${Date.now()}-${fallbackWalkId}`;
}

// ============================================================
// Element classification
// ============================================================

/** Whether to skip entirely (no traversal, no translation) */
function shouldSkipEntirely(element: HTMLElement): boolean {
  return shouldSkipSubtree(element);
}

/** Whether this is an atomic inline element (not traversed, but its text takes part in the parent's translation) */
function isAtomicInline(element: HTMLElement): boolean {
  return ATOMIC_INLINE_TAGS.has(element.tagName);
}

/** Determine whether an element is inline based on computed style */
function isInlineElement(element: HTMLElement): boolean {
  // Elements without text content do not count as inline
  if (!element.textContent?.trim()) return false;

  // Forced block tags
  if (FORCE_BLOCK_TAGS.has(element.tagName)) return false;

  const style = window.getComputedStyle(element);
  const display = style.display;

  // inline / inline-block / inline-flex / contents treated as inline
  return display.includes('inline') || display === 'contents';
}

// ============================================================
// Text extraction
// ============================================================

/**
 * Extract text content from a paragraph node, preserving sensible whitespace
 */
function extractTextFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const trimmed = text.trim();
    if (!trimmed) return '';

    // Keep meaningful leading/trailing spaces (non-newline whitespace)
    const hasLeading = /^\s/.test(text) && !/^\n/.test(text);
    const hasTrailing = /\s$/.test(text) && !/\n$/.test(text);
    return (hasLeading ? ' ' : '') + trimmed + (hasTrailing ? ' ' : '');
  }

  if (!isHTMLElement(node)) return '';

  const element = node as HTMLElement;

  if (element.tagName === 'BR') return '\n';

  // Skip fully ignored elements
  if (shouldSkipEntirely(element)) return '';

  // Atomic inline element - take its text directly
  if (isAtomicInline(element)) {
    return element.textContent?.trim() ?? '';
  }

  // Recurse into child nodes
  let result = '';
  for (const child of element.childNodes) {
    result += extractTextFromNode(child);
  }
  return result;
}

/**
 * Collect text nodes within a paragraph
 */
function collectTextNodes(element: HTMLElement): Text[] {
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      return isTranslatableTextNode(node as Text, element)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }
  return textNodes;
}

// ============================================================
// Core traversal logic
// ============================================================

/**
 * Traverse and mark DOM elements
 *
 * Recursively traverse the subtree of element, tagging each node semantically:
 * - data-illa-walked: traversed (value is walkId)
 * - data-illa-paragraph: paragraph node (contains inline children, is a translation unit)
 * - data-illa-block: block-level node
 * - data-illa-inline: inline node
 */
function walkAndLabel(element: HTMLElement, walkId: string): WalkResult {
  // Already traversed in this walk, skip
  if (element.getAttribute(DOM_LABELS.WALKED) === walkId) {
    return { forceBlock: false, isInline: false };
  }

  // Atomic inline - do not descend, mark as inline
  if (isAtomicInline(element)) {
    return { forceBlock: false, isInline: true };
  }

  // Skip entirely
  if (shouldSkipEntirely(element)) {
    return { forceBlock: false, isInline: false };
  }

  // Mark as traversed
  element.setAttribute(DOM_LABELS.WALKED, walkId);

  let hasInlineChild = false;

  // Traverse child nodes
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) {
        hasInlineChild = true;
      }
    } else if (isHTMLElement(child)) {
      const result = walkAndLabel(child, walkId);
      if (result.isInline) {
        hasInlineChild = true;
      }
    }
  }

  // Mark paragraph: node containing inline children
  if (hasInlineChild) {
    element.setAttribute(DOM_LABELS.PARAGRAPH, '');
  }

  // Determine block / inline
  const inline = isInlineElement(element);
  if (inline) {
    element.setAttribute(DOM_LABELS.INLINE, '');
  } else {
    element.setAttribute(DOM_LABELS.BLOCK, '');
  }

  return { forceBlock: false, isInline: inline };
}

/**
 * Clear walk markers
 */
function clearLabels(root: HTMLElement): void {
  const labeled = root.querySelectorAll(
    `[${DOM_LABELS.WALKED}], [${DOM_LABELS.PARAGRAPH}], [${DOM_LABELS.BLOCK}], [${DOM_LABELS.INLINE}]`,
  );
  for (const el of labeled) {
    el.removeAttribute(DOM_LABELS.WALKED);
    el.removeAttribute(DOM_LABELS.PARAGRAPH);
    el.removeAttribute(DOM_LABELS.BLOCK);
    el.removeAttribute(DOM_LABELS.INLINE);
  }
  // Also clear the root itself
  root.removeAttribute(DOM_LABELS.WALKED);
  root.removeAttribute(DOM_LABELS.PARAGRAPH);
  root.removeAttribute(DOM_LABELS.BLOCK);
  root.removeAttribute(DOM_LABELS.INLINE);
}

// ============================================================
// Public API
// ============================================================

/**
 * Traverse the DOM and collect all paragraph info
 *
 * This is the entry point shared by both translation modes:
 * - Word translation mode: build ContentSegment from the returned ParagraphInfo
 * - Paragraph translation mode: use the returned ParagraphInfo.element as the translation unit
 *
 * @param root root node to traverse
 * @returns list of paragraph info (in document order)
 */
export function walkAndCollectParagraphs(root: HTMLElement): ParagraphInfo[] {
  const walkId = createWalkId();

  // Step 1: traverse and mark
  walkAndLabel(root, walkId);

  // Step 2: collect all paragraph nodes
  const paragraphElements = [
    ...(root.hasAttribute(DOM_LABELS.PARAGRAPH) ? [root] : []),
    ...Array.from(
      root.querySelectorAll<HTMLElement>(`[${DOM_LABELS.PARAGRAPH}]`),
    ),
  ];

  const paragraphs: ParagraphInfo[] = [];

  for (const element of paragraphElements) {
    // Skip nodes that contain other paragraphs (take leaf paragraphs only)
    // But keep it if the paragraph has block children (the caller handles mixed content later)
    const childParagraphs = element.querySelectorAll(
      `[${DOM_LABELS.PARAGRAPH}]`,
    );
    if (childParagraphs.length > 0) {
      // Check whether all child paragraphs are inline (i.e. this node itself is the final paragraph)
      let hasBlockParagraphChild = false;
      for (const cp of childParagraphs) {
        if (cp.hasAttribute(DOM_LABELS.BLOCK)) {
          hasBlockParagraphChild = true;
          break;
        }
      }
      // If there are block child paragraphs, skip this node (let the children handle themselves)
      if (hasBlockParagraphChild) continue;
    }

    const textContent = extractTextFromNode(element);
    if (!textContent.trim() || textContent.trim().length < 2) continue;

    const textNodes = collectTextNodes(element);
    if (textNodes.length === 0) continue;

    paragraphs.push({ element, textContent, textNodes });
  }

  // Step 3: clear markers to avoid polluting the DOM
  clearLabels(root);

  return paragraphs;
}

/**
 * Determine whether an element should be skipped (for use by external modules)
 */
export {
  shouldSkipEntirely,
  isInlineElement,
  isHTMLElement,
  extractTextFromNode,
  collectTextNodes,
};
