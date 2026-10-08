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
import { walkAndCollectParagraphsAsync } from './DomWalker';

export interface SegmenterConfig {
  maxSegmentLength: number;
  minSegmentLength: number;
  mergeSmallSegments: boolean;
}

const DEFAULT_CONFIG: SegmenterConfig = {
  maxSegmentLength: 400,
  minSegmentLength: 20,
  mergeSmallSegments: true,
};

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

    for (const para of paragraphs) {
      if (para.textContent.trim().length < this.config.minSegmentLength) {
        continue;
      }

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
