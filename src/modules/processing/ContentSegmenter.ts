/**
 * Smart content segmenter
 *
 * Splits the DOM into sensible processing units based on the paragraph markers from DomWalker.
 * Word translation and paragraph translation share DomWalker to obtain paragraphs. This module is responsible for:
 * 1. Converting paragraphs to ContentSegment
 * 2. Smartly splitting long text
 * 3. Merging fragmented small paragraphs
 */

import {
  ContentSegment,
  globalProcessingState,
} from './ProcessingStateManager';
import { walkAndCollectParagraphsAsync, type ParagraphInfo } from './DomWalker';

export interface SegmenterConfig {
  maxSegmentLength: number;
  minSegmentLength: number;
  mergeSmallSegments: boolean;
}

const DEFAULT_CONFIG: SegmenterConfig = {
  maxSegmentLength: 400,
  minSegmentLength: 20,
  // Off by default: request batching already packs small segments into one
  // request, and merging them prevents exact deduplication of repeated text.
  mergeSmallSegments: false,
};

/**
 * Ensure every text node ends up in at most one segment.
 *
 * The walker also reports inline paragraphs nested in another paragraph (e.g.
 * a long <a> inside a <p>); paragraph mode needs them for element selection,
 * but as word-mode segments they would send the same text twice. Paragraphs
 * arrive in document order, so the outer paragraph claims its text nodes
 * first: a fully covered paragraph is dropped (null), a partially covered one
 * keeps only its unclaimed text nodes.
 */
export function withUnclaimedTextNodes(
  paragraph: ParagraphInfo,
  claimed: ReadonlySet<Text>,
): ParagraphInfo | null {
  const textNodes = paragraph.textNodes.filter((node) => !claimed.has(node));
  if (textNodes.length === 0) return null;
  if (textNodes.length === paragraph.textNodes.length) return paragraph;

  return {
    element: paragraph.element,
    textNodes,
    textContent: textNodes.map((node) => node.textContent ?? '').join(''),
  };
}

export class ContentSegmenter {
  private config: SegmenterConfig;

  constructor(config: Partial<SegmenterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Split a root node into content segments.
   * The DOM walk is time-sliced, so this yields to the main thread on large roots.
   */
  async segmentContent(root: Node): Promise<ContentSegment[]> {
    if (!(root instanceof HTMLElement)) return [];

    // Get all paragraphs from the DomWalker
    const paragraphs = await walkAndCollectParagraphsAsync(root);
    const segments: ContentSegment[] = [];
    const claimedTextNodes = new Set<Text>();

    for (const rawPara of paragraphs) {
      const para = withUnclaimedTextNodes(rawPara, claimedTextNodes);
      if (!para) continue;

      if (para.textContent.trim().length < this.config.minSegmentLength) {
        continue;
      }
      para.textNodes.forEach((node) => claimedTextNodes.add(node));

      const domPath = globalProcessingState.generateDomPath(para.element);

      if (para.textContent.length <= this.config.maxSegmentLength) {
        // Short text - single segment
        const fingerprint = globalProcessingState.generateContentFingerprint(
          para.textContent,
          domPath,
        );
        segments.push({
          id: `${para.element.tagName.toLowerCase()}-${fingerprint}`,
          textContent: para.textContent,
          element: para.element,
          elements: [para.element],
          textNodes: para.textNodes,
          fingerprint,
          domPath,
        });
      } else {
        // Long text - split on text node boundaries
        const subSegments = this.splitLongText(
          para.textNodes,
          para.element,
          domPath,
        );
        segments.push(...subSegments);
      }
    }

    if (this.config.mergeSmallSegments) {
      return this.mergeSmallSegments(segments);
    }

    return segments;
  }

  /**
   * Split long text on text node boundaries
   */
  private splitLongText(
    textNodes: Text[],
    container: Element,
    domPath: string,
  ): ContentSegment[] {
    const segments: ContentSegment[] = [];
    let currentNodes: Text[] = [];
    let currentLength = 0;
    let segmentIndex = 0;

    for (const textNode of textNodes) {
      const nodeText = textNode.textContent || '';

      if (
        currentLength + nodeText.length > this.config.maxSegmentLength &&
        currentNodes.length > 0
      ) {
        segments.push(
          this.buildSegment(currentNodes, container, domPath, segmentIndex),
        );
        currentNodes = [];
        currentLength = 0;
        segmentIndex++;
      }

      currentNodes.push(textNode);
      currentLength += nodeText.length;
    }

    if (currentNodes.length > 0) {
      segments.push(
        this.buildSegment(currentNodes, container, domPath, segmentIndex),
      );
    }

    return segments;
  }

  private buildSegment(
    textNodes: Text[],
    container: Element,
    domPath: string,
    index: number,
  ): ContentSegment {
    const text = textNodes.map((n) => n.textContent || '').join('');
    const path = `${domPath}[${index}]`;
    const fingerprint = globalProcessingState.generateContentFingerprint(
      text,
      path,
    );
    return {
      id: `${container.tagName.toLowerCase()}-${fingerprint}-${index}`,
      textContent: text,
      element: container,
      elements: [container],
      textNodes: [...textNodes],
      fingerprint,
      domPath: path,
    };
  }

  /**
   * Merge adjacent small segments
   */
  private mergeSmallSegments(segments: ContentSegment[]): ContentSegment[] {
    if (segments.length <= 1) return segments;

    const merged: ContentSegment[] = [];
    let group: ContentSegment[] = [];

    for (let i = 0; i < segments.length; i++) {
      group.push(segments[i]);

      const totalLength = group.reduce(
        (sum, seg) => sum + seg.textContent.length,
        0,
      );

      if (
        totalLength >= this.config.minSegmentLength * 2 ||
        i === segments.length - 1
      ) {
        if (group.length === 1) {
          merged.push(group[0]);
        } else {
          merged.push(this.createMergedSegment(group));
        }
        group = [];
      }
    }

    return merged;
  }

  private createMergedSegment(segments: ContentSegment[]): ContentSegment {
    const text = segments.map((s) => s.textContent).join('');
    const nodes = segments.flatMap((s) => s.textNodes);
    const elements = segments.map((s) => s.element);
    const domPath = segments.map((s) => s.domPath).join('|');
    const fingerprint = globalProcessingState.generateContentFingerprint(
      text,
      domPath,
    );

    return {
      id: `merged-${fingerprint}`,
      textContent: text,
      element: segments[0].element,
      elements,
      textNodes: nodes,
      fingerprint,
      domPath,
    };
  }

  updateConfig(newConfig: Partial<SegmenterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): SegmenterConfig {
    return { ...this.config };
  }
}
