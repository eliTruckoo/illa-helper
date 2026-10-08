/**
 * Smart segment observer - used for lazy loading
 *
 * Segments are keyed by element, and one element can carry several segments
 * (a long paragraph is split into sub-segments), so every element maps to a
 * list. Segments are removed (and the element unobserved) once processed, and
 * detached elements are pruned, so long-lived feeds do not retain old DOM.
 */

import { ContentSegment } from '../../processing/ProcessingStateManager';

/**
 * Observer callback function
 */
export type SegmentObserverCallback = (
  visibleSegments: ContentSegment[],
  invisibleSegments: ContentSegment[],
) => void;

/**
 * Observer configuration options
 */
export interface SegmentObserverOptions {
  /** Preload distance percentage */
  preloadDistance?: number;
}

/** Sweep detached elements after this many newly observed elements */
const PRUNE_INTERVAL = 200;

/**
 * Smart segment observer
 * Implements lazy loading based on IntersectionObserver
 */
export class SegmentObserver {
  private observer: IntersectionObserver | null = null;
  private segmentMap = new Map<Element, ContentSegment[]>();
  private callback: SegmentObserverCallback;
  private options: SegmentObserverOptions;
  private isDestroyed = false;
  private observedSincePrune = 0;

  constructor(
    callback: SegmentObserverCallback,
    options: SegmentObserverOptions = {},
  ) {
    this.callback = callback;
    this.options = options;
    this.initializeObserver();
  }

  /**
   * Initialize the observer
   */
  private initializeObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    try {
      const preloadDistance = this.options.preloadDistance || 0.5;
      const marginPercent = Math.round(preloadDistance * 100);

      const observerOptions: IntersectionObserverInit = {
        rootMargin: `${marginPercent}% 0px ${marginPercent}% 0px`,
        threshold: 0.1,
        root: null,
      };

      this.observer = new IntersectionObserver(
        this.handleIntersection.bind(this),
        observerOptions,
      );
    } catch (error) {
      console.error('[SegmentObserver] Failed to create observer:', error);
    }
  }

  /**
   * Handle intersection changes
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    if (this.isDestroyed || !this.observer) return;

    const visibleSegments: ContentSegment[] = [];
    const invisibleSegments: ContentSegment[] = [];

    entries.forEach((entry) => {
      const segments = this.segmentMap.get(entry.target);
      if (!segments) return;

      if (entry.isIntersecting) {
        visibleSegments.push(...segments);
      } else if (!entry.target.isConnected) {
        // Removed from the page: stop tracking it.
        this.removeElement(entry.target);
      } else {
        invisibleSegments.push(...segments);
      }
    });

    if (visibleSegments.length > 0 || invisibleSegments.length > 0) {
      try {
        this.callback(visibleSegments, invisibleSegments);
      } catch (error) {
        console.error('[SegmentObserver] Callback execution failed:', error);
      }
    }
  }

  /**
   * Observe segment
   */
  observe(segment: ContentSegment): void {
    this.observeMultiple([segment]);
  }

  /**
   * Observe multiple segments
   */
  observeMultiple(segments: ContentSegment[]): void {
    if (this.isDestroyed || !this.observer) return;

    const added: ContentSegment[] = [];
    segments.forEach((segment) => {
      if (this.addSegment(segment)) added.push(segment);
    });

    if (this.observedSincePrune >= PRUNE_INTERVAL) {
      this.pruneDetached();
    }

    this.emitInitiallyVisible(added);
  }

  /**
   * Track a segment. Returns false if it was invalid or already tracked.
   */
  private addSegment(segment: ContentSegment): boolean {
    const targetElement = segment.element;
    if (!targetElement || !(targetElement instanceof Element)) {
      return false;
    }

    try {
      const existing = this.segmentMap.get(targetElement);
      if (existing) {
        if (existing.some((s) => s.fingerprint === segment.fingerprint)) {
          return false;
        }
        existing.push(segment);
        return true;
      }

      this.segmentMap.set(targetElement, [segment]);
      this.observer!.observe(targetElement);
      this.observedSincePrune++;
      return true;
    } catch (error) {
      console.error('[SegmentObserver] Failed to observe segment:', error);
      return false;
    }
  }

  /**
   * Stop observing segment
   */
  unobserve(segment: ContentSegment): void {
    if (this.isDestroyed || !this.observer) return;

    const targetElement = segment.element;
    if (!targetElement || !(targetElement instanceof Element)) return;

    const segments = this.segmentMap.get(targetElement);
    if (!segments) return;

    const remaining = segments.filter(
      (s) => s !== segment && s.fingerprint !== segment.fingerprint,
    );
    if (remaining.length > 0) {
      this.segmentMap.set(targetElement, remaining);
      return;
    }

    this.removeElement(targetElement);
  }

  /**
   * Stop observing segments in batch
   */
  unobserveMultiple(segments: ContentSegment[]): void {
    segments.forEach((segment) => this.unobserve(segment));
  }

  private removeElement(element: Element): void {
    this.segmentMap.delete(element);
    try {
      this.observer?.unobserve(element);
    } catch (error) {
      console.error('[SegmentObserver] Failed to stop observing:', error);
    }
  }

  /**
   * Drop elements that are no longer in the document.
   */
  pruneDetached(): void {
    this.observedSincePrune = 0;
    for (const element of Array.from(this.segmentMap.keys())) {
      if (!element.isConnected) {
        this.removeElement(element);
      }
    }
  }

  /**
   * IntersectionObserver misses tall elements whose visible ratio never
   * reaches the threshold, so report segments that are already in (or near)
   * the viewport right away. Layout is read once per element, in one pass.
   */
  private emitInitiallyVisible(segments: ContentSegment[]): void {
    if (segments.length === 0) return;

    const preloadDistance = this.options.preloadDistance || 0.5;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const preloadPx = viewportHeight * preloadDistance;

    const visibility = new Map<Element, boolean>();
    const visible = segments.filter((segment) => {
      const targetElement = segment.element;
      let isVisible = visibility.get(targetElement);
      if (isVisible === undefined) {
        const rect = targetElement.getBoundingClientRect();
        isVisible =
          rect.bottom >= -preloadPx && rect.top <= viewportHeight + preloadPx;
        visibility.set(targetElement, isVisible);
      }
      return isVisible;
    });

    if (visible.length > 0) {
      try {
        this.callback(visible, []);
      } catch (error) {
        console.error('[SegmentObserver] Callback execution failed:', error);
      }
    }
  }

  /**
   * Update observer options (observed segments are kept)
   */
  updateOptions(newOptions: SegmentObserverOptions): void {
    if (this.isDestroyed) return;

    this.options = { ...this.options, ...newOptions };
    const segments = this.getObservedSegments();
    this.disconnect();
    this.initializeObserver();
    this.observeMultiple(segments);
  }

  /**
   * Disconnect all observation
   */
  disconnect(): void {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (error) {
        console.error(
          '[SegmentObserver] Failed to disconnect observer:',
          error,
        );
      }
    }
    this.segmentMap.clear();
    this.observedSincePrune = 0;
  }

  /**
   * Destroy the observer
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.disconnect();
    this.observer = null;
  }

  // State query methods
  getObservedCount(): number {
    let count = 0;
    this.segmentMap.forEach((segments) => (count += segments.length));
    return count;
  }

  isObserving(segment: ContentSegment): boolean {
    return (
      this.segmentMap
        .get(segment.element)
        ?.some((s) => s.fingerprint === segment.fingerprint) ?? false
    );
  }

  getObservedSegments(): ContentSegment[] {
    return Array.from(this.segmentMap.values()).flat();
  }

  static isSupported(): boolean {
    return typeof IntersectionObserver !== 'undefined';
  }
}
