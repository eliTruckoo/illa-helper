/**
 * DOM Walker - shared DOM traversal module
 *
 * Based on the walk-label design of read-frog:
 * 1. Depth-first traversal of the DOM tree
 * 2. block/inline is decided from getComputedStyle (semantic tags are forced to block)
 * 3. Nodes with inline child content are "paragraphs" (the basic translation unit)
 *
 * Performance notes:
 * - Single pass over the tree with an explicit stack; every element is visited
 *   once and its computed style is read at most once (per-walk cache).
 * - No DOM attributes are written: walk state lives in memory, so the walk does
 *   not flood page MutationObservers or invalidate selectors.
 * - Skipped subtrees are pruned once instead of re-checking every ancestor of
 *   every text node.
 * - walkAndCollectParagraphsAsync time-slices the walk and yields to the main
 *   thread between slices so large pages never produce one long task.
 *
 * Word translation and paragraph translation both get their DOM nodes from here.
 */

import { ATOMIC_INLINE_TAGS, FORCE_BLOCK_TAGS } from '../shared/constants';
import {
  createDomPolicyCache,
  getStyleSnapshot,
  isHTMLElement,
  shouldSkipSubtree,
  shouldSkipSubtreeCached,
  type DomPolicyCache,
} from './DomTranslationPolicy';

// ============================================================
// Type definitions
// ============================================================

export interface WalkResult {
  /** Whether the node is forced to be block */
  forceBlock: boolean;
  /** Whether the node is inline */
  isInline: boolean;
}

export interface ParagraphInfo {
  /** Paragraph element */
  element: HTMLElement;
  /** Extracted text content */
  textContent: string;
  /** Text nodes inside the paragraph */
  textNodes: Text[];
}

export interface WalkOptions {
  /** Maximum time (ms) spent per slice before yielding to the main thread */
  sliceMs?: number;
}

/** Default slice length; keeps every task well below the 50 ms long-task mark. */
const DEFAULT_SLICE_MS = 6;

/** How many nodes are visited between two clock reads. */
const DEADLINE_CHECK_INTERVAL = 32;

const NON_WHITESPACE = /\S/;

function now(): number {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

/**
 * Yield to the main thread so input and rendering can run between slices.
 * Prefers scheduler.yield() (keeps task priority), then a MessageChannel
 * message (no 4 ms timer clamping), then setTimeout(0).
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (
    globalThis as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }

  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================
// Element classification
// ============================================================

/** Whether the element should be skipped entirely (not walked, not translated) */
function shouldSkipEntirely(element: HTMLElement): boolean {
  return shouldSkipSubtree(element);
}

/** Whether the element is an atomic inline element (not descended into, but its text joins the parent translation) */
function isAtomicInline(element: Element): boolean {
  return ATOMIC_INLINE_TAGS.has(element.tagName);
}

function hasNonWhitespaceText(element: Element): boolean {
  return NON_WHITESPACE.test(element.textContent ?? '');
}

function isInlineDisplay(element: Element, cache?: DomPolicyCache): boolean {
  const display = getStyleSnapshot(element, cache)?.display ?? '';
  // inline / inline-block / inline-flex / contents count as inline
  return display.includes('inline') || display === 'contents';
}

/** Decide whether an element is inline based on its computed style */
function isInlineElement(element: HTMLElement): boolean {
  // Elements without text content do not count as inline
  if (!hasNonWhitespaceText(element)) return false;

  // Forced block tags
  if (FORCE_BLOCK_TAGS.has(element.tagName)) return false;

  return isInlineDisplay(element);
}

// ============================================================
// Text extraction
// ============================================================

/** Keep meaningful leading/trailing spaces (non-newline whitespace). */
function formatTextNodeText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const hasLeading = /^\s/.test(text) && !/^\n/.test(text);
  const hasTrailing = /\s$/.test(text) && !/\n$/.test(text);
  return (hasLeading ? ' ' : '') + trimmed + (hasTrailing ? ' ' : '');
}

/**
 * Extract text content from a paragraph node, preserving reasonable whitespace
 */
function extractTextFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return formatTextNodeText(node.textContent ?? '');
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

  // Recurse into children
  let result = '';
  for (const child of element.childNodes) {
    result += extractTextFromNode(child);
  }
  return result;
}

interface ParagraphCollectState {
  text: string;
  textNodes: Text[];
}

/**
 * Collect the text and the translatable text nodes of a paragraph in a single
 * traversal. Skipped subtrees are pruned once (their text is neither extracted
 * nor collected). Atomic inline elements contribute their whole trimmed text,
 * while their translatable text nodes are still collected.
 */
function visitParagraphNode(
  node: Node,
  inAtomic: boolean,
  state: ParagraphCollectState,
  cache: DomPolicyCache,
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node as Text).data ?? node.textContent ?? '';
    if (!NON_WHITESPACE.test(text)) return;

    state.textNodes.push(node as Text);
    if (!inAtomic) {
      state.text += formatTextNodeText(text);
    }
    return;
  }

  if (!isHTMLElement(node)) return;

  if (node.tagName === 'BR') {
    if (!inAtomic) state.text += '\n';
    return;
  }

  // Ancestors up to the paragraph (and the paragraph's own ancestors) were
  // verified by the caller, so only the element itself needs checking.
  if (shouldSkipSubtreeCached(node, cache, true)) return;

  let childInAtomic = inAtomic;
  if (!inAtomic && isAtomicInline(node)) {
    state.text += node.textContent?.trim() ?? '';
    childInAtomic = true;
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    visitParagraphNode(child, childInAtomic, state, cache);
  }
}

function collectParagraphContent(
  element: HTMLElement,
  cache: DomPolicyCache,
): ParagraphCollectState {
  const state: ParagraphCollectState = { text: '', textNodes: [] };
  for (let child = element.firstChild; child; child = child.nextSibling) {
    visitParagraphNode(child, false, state, cache);
  }
  return state;
}

/**
 * Collect the text nodes inside a paragraph
 */
function collectTextNodes(element: HTMLElement): Text[] {
  const cache = createDomPolicyCache();
  if (shouldSkipSubtreeCached(element, cache, false)) return [];
  return collectParagraphContent(element, cache).textNodes;
}

// ============================================================
// Core traversal
// ============================================================

interface WalkFrame {
  element: HTMLElement;
  /** Next child to visit */
  next: ChildNode | null;
  /** Index of this element's slot in document order */
  slot: number;
  /** Has a non-empty text child or an inline child element (=> paragraph) */
  hasInlineChild: boolean;
  /** Equivalent of `element.textContent.trim() !== ''` */
  hasText: boolean;
  /** Some descendant is a block-level paragraph */
  hasBlockParagraphDescendant: boolean;
}

/**
 * Resumable paragraph walk.
 *
 * Phase 1 walks the tree once and classifies every element (paragraph,
 * inline/block) bottom-up. Phase 2 extracts text and text nodes of the leaf
 * paragraphs. Both phases can be interrupted at a deadline and resumed.
 */
class ParagraphWalk {
  private readonly cache = createDomPolicyCache();
  private readonly stack: WalkFrame[] = [];
  /** Paragraphs to collect, by pre-order slot (null = not a paragraph) */
  private readonly slots: Array<HTMLElement | null> = [];
  private readonly paragraphs: ParagraphInfo[] = [];
  private readonly requireConnected: boolean;
  private collectIndex = 0;

  constructor(root: HTMLElement) {
    this.requireConnected = root.isConnected === true;

    // Atomic inline roots are not descended into; skipped roots are ignored.
    // The root check uses closest() so extension-owned ancestors are honoured.
    if (
      isAtomicInline(root) ||
      shouldSkipSubtreeCached(root, this.cache, false)
    ) {
      return;
    }
    this.push(root);
  }

  /**
   * Run until done or until the deadline passes.
   * @returns true when the walk is complete
   */
  step(deadline: number): boolean {
    let counter = 0;

    while (this.stack.length > 0) {
      if (++counter % DEADLINE_CHECK_INTERVAL === 0 && now() >= deadline) {
        return false;
      }

      const frame = this.stack[this.stack.length - 1];
      const child = frame.next;
      if (child === null) {
        this.stack.pop();
        this.finish(frame);
        continue;
      }

      frame.next = child.nextSibling;
      this.visitChild(frame, child);
    }

    while (this.collectIndex < this.slots.length) {
      // Always make progress: at least one slot per step.
      if (++counter > 1 && now() >= deadline) {
        return false;
      }

      const element = this.slots[this.collectIndex++];
      if (!element) continue;
      // The DOM may have changed while the walk was yielding.
      if (this.requireConnected && !element.isConnected) continue;

      const { text, textNodes } = collectParagraphContent(element, this.cache);
      if (text.trim().length < 2) continue;
      if (textNodes.length === 0) continue;

      this.paragraphs.push({ element, textContent: text, textNodes });
    }

    return true;
  }

  result(): ParagraphInfo[] {
    return this.paragraphs;
  }

  private push(element: HTMLElement): void {
    this.stack.push({
      element,
      next: element.firstChild,
      slot: this.slots.length,
      hasInlineChild: false,
      hasText: false,
      hasBlockParagraphDescendant: false,
    });
    this.slots.push(null);
  }

  private visitChild(frame: WalkFrame, child: ChildNode): void {
    if (child.nodeType === Node.TEXT_NODE) {
      if (
        NON_WHITESPACE.test((child as Text).data ?? child.textContent ?? '')
      ) {
        frame.hasInlineChild = true;
        frame.hasText = true;
      }
      return;
    }

    if (!isHTMLElement(child)) return;

    // Atomic inline - not descended into, counts as inline
    if (isAtomicInline(child)) {
      frame.hasInlineChild = true;
      if (!frame.hasText) frame.hasText = hasNonWhitespaceText(child);
      return;
    }

    // Skipped entirely; its text still counts for the parent's textContent
    if (shouldSkipSubtreeCached(child, this.cache, true)) {
      if (!frame.hasText) frame.hasText = hasNonWhitespaceText(child);
      return;
    }

    this.push(child);
  }

  private finish(frame: WalkFrame): void {
    const { element } = frame;
    const isParagraph = frame.hasInlineChild;
    const isInline =
      frame.hasText &&
      !FORCE_BLOCK_TAGS.has(element.tagName) &&
      isInlineDisplay(element, this.cache);

    // Only leaf paragraphs are kept: a paragraph containing a block-level
    // paragraph is left to its children. Inline child paragraphs are kept
    // (callers handle the mixed content).
    if (isParagraph && !frame.hasBlockParagraphDescendant) {
      this.slots[frame.slot] = element;
    }

    const parent = this.stack[this.stack.length - 1];
    if (!parent) return;

    if (isInline) parent.hasInlineChild = true;
    if (frame.hasText) parent.hasText = true;
    if ((isParagraph && !isInline) || frame.hasBlockParagraphDescendant) {
      parent.hasBlockParagraphDescendant = true;
    }
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Walk the DOM synchronously and collect all paragraphs.
 *
 * Shared entry point for both translation modes:
 * - Word translation mode: builds ContentSegments from the returned ParagraphInfo
 * - Paragraph translation mode: uses ParagraphInfo.element as the translation unit
 *
 * Prefer walkAndCollectParagraphsAsync for large roots (e.g. document.body).
 *
 * @param root Root node to walk
 * @returns List of paragraph info (in document order)
 */
export function walkAndCollectParagraphs(root: HTMLElement): ParagraphInfo[] {
  const walk = new ParagraphWalk(root);
  walk.step(Number.POSITIVE_INFINITY);
  return walk.result();
}

/**
 * Time-sliced variant of walkAndCollectParagraphs with identical output.
 * Works for at most `sliceMs` per task and yields to the main thread between
 * slices. Nodes inserted while the walk is paused may be missed (the DOM
 * observer picks them up); paragraphs detached meanwhile are dropped.
 */
export async function walkAndCollectParagraphsAsync(
  root: HTMLElement,
  options: WalkOptions = {},
): Promise<ParagraphInfo[]> {
  const sliceMs = options.sliceMs ?? DEFAULT_SLICE_MS;
  const walk = new ParagraphWalk(root);

  while (!walk.step(now() + sliceMs)) {
    await yieldToMain();
  }

  return walk.result();
}

/**
 * Helpers for other modules
 */
export {
  shouldSkipEntirely,
  isInlineElement,
  isHTMLElement,
  extractTextFromNode,
  collectTextNodes,
};
