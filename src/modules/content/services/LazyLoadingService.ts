/**
 * Lazy loading service - manages viewport-based lazy translation
 *
 * Core features:
 * 1. Manage the Intersection Observer instance
 * 2. Coordinate viewport detection and translation triggering
 * 3. Handle observer updates for dynamic content
 * 4. Provide performance optimization and error handling
 */

import type { LazyLoadingConfig } from '../../shared/types/core';
import type { ContentSegment } from '../../processing/ProcessingStateManager';
import {
  SegmentObserver,
  type SegmentObserverCallback,
} from '../utils/SegmentObserver';

/** Upper bound of remembered processed fingerprints (oldest evicted first) */
const MAX_PROCESSED_FINGERPRINTS = 5000;

/**
 * Lazy loading callback function type
 */
export type LazyLoadingCallback = (segments: ContentSegment[]) => Promise<void>;

/**
 * Lazy loading service state
 */
interface LazyLoadingState {
  /** Whether initialized */
  initialized: boolean;
  /** Whether enabled */
  enabled: boolean;
  /** Queue of pending segments */
  processingQueue: Set<string>;
  /** Record of processed segments */
  processedSegments: Set<string>;
  /** Segment cache */
  segmentCache: Map<string, ContentSegment>;
}

/**
 * Lazy loading service
 */
export class LazyLoadingService {
  private config: LazyLoadingConfig;
  private observer: SegmentObserver | null = null;
  private processingCallback: LazyLoadingCallback | null = null;
  private state: LazyLoadingState;
  private processingTimer: number | null = null;
  private isDestroyed = false;

  constructor(config: LazyLoadingConfig) {
    this.config = { ...config };
    this.state = {
      initialized: false,
      enabled: false,
      processingQueue: new Set(),
      processedSegments: new Set(),
      segmentCache: new Map(),
    };
  }

  /**
   * Initialize the lazy loading service
   */
  initialize(): void {
    if (this.state.initialized) return;

    this.state.initialized = true;
    this.state.enabled = this.config.enabled;

    if (this.config.enabled) {
      this.createObserver();
    }
  }

  /**
   * Create the observer
   */
  private createObserver(): void {
    if (this.observer) {
      this.observer.destroy();
    }

    const observerCallback: SegmentObserverCallback = (
      visibleSegments,
      invisibleSegments,
    ) => {
      this.handleVisibilityChange(visibleSegments);
    };

    const observerOptions = {
      preloadDistance: this.config.preloadDistance,
    };

    this.observer = new SegmentObserver(observerCallback, observerOptions);
  }

  /**
   * Handle segment visibility changes
   */
  private handleVisibilityChange(visibleSegments: ContentSegment[]): void {
    if (!this.state.enabled || this.isDestroyed) return;

    // Handle segments entering the viewport
    if (visibleSegments.length > 0) {
      this.scheduleProcessing(visibleSegments);
    }
  }

  /**
   * Schedule processing - prevents concurrency issues
   */
  private scheduleProcessing(segments: ContentSegment[]): void {
    // Filter out already processed segments
    const unprocessedSegments: ContentSegment[] = [];
    segments.forEach((segment) => {
      if (this.state.processedSegments.has(segment.fingerprint)) {
        // Already done (e.g. re-observed by a rescan): stop observing it.
        this.observer?.unobserve(segment);
      } else {
        unprocessedSegments.push(segment);
      }
    });

    if (unprocessedSegments.length === 0) return;

    // Add to the processing queue and cache
    unprocessedSegments.forEach((segment) => {
      this.state.processingQueue.add(segment.fingerprint);
      this.state.segmentCache.set(segment.fingerprint, segment);
    });

    this.scheduleQueueDrain();
  }

  private scheduleQueueDrain(): void {
    if (this.processingTimer) {
      return;
    }

    // Defer processing to avoid frequent triggering
    this.processingTimer = window.setTimeout(() => {
      this.processAllQueuedSegments();
    }, 100);
  }

  /**
   * Process all segments in the queue - fixes the concurrent-skip problem
   */
  private async processAllQueuedSegments(): Promise<void> {
    if (!this.processingCallback || this.isDestroyed) return;

    const allQueuedFingerprints = Array.from(this.state.processingQueue);
    if (allQueuedFingerprints.length === 0) {
      this.processingTimer = null;
      return;
    }

    const segmentsToProcess: ContentSegment[] = [];
    allQueuedFingerprints.forEach((fingerprint) => {
      const segment = this.state.segmentCache.get(fingerprint);
      if (segment) {
        segmentsToProcess.push(segment);
      }
    });

    if (segmentsToProcess.length === 0) {
      this.processingTimer = null;
      return;
    }

    try {
      await this.runProcessingCallbackWhenIdle(segmentsToProcess);

      // Mark as processed and remove from the cache; processed segments are no longer
      // observed, so the observer releases their elements.
      segmentsToProcess.forEach((segment) => {
        this.rememberProcessed(segment.fingerprint);
        this.state.processingQueue.delete(segment.fingerprint);
        this.state.segmentCache.delete(segment.fingerprint);
      });
      this.observer?.unobserveMultiple(segmentsToProcess);
    } catch (_) {
      // Clean up the queue even on failure to avoid reprocessing. Failed segments stay observed
      // so they are retried when they re-enter the viewport.
      segmentsToProcess.forEach((segment) => {
        this.state.processingQueue.delete(segment.fingerprint);
        this.state.segmentCache.delete(segment.fingerprint);
      });
    } finally {
      this.processingTimer = null;
      if (this.state.processingQueue.size > 0 && !this.isDestroyed) {
        // New segments that enter the viewport during processing stay in the queue and are drained after the current batch.
        this.scheduleQueueDrain();
      }
    }
  }

  private rememberProcessed(fingerprint: string): void {
    const processed = this.state.processedSegments;
    processed.delete(fingerprint);
    processed.add(fingerprint);
    while (processed.size > MAX_PROCESSED_FINGERPRINTS) {
      const oldest = processed.values().next().value;
      if (oldest === undefined) break;
      processed.delete(oldest);
    }
  }

  private async runProcessingCallbackWhenIdle(
    segments: ContentSegment[],
  ): Promise<void> {
    if (!this.processingCallback) return;

    if ('requestIdleCallback' in window) {
      await new Promise<void>((resolve, reject) => {
        window.requestIdleCallback(() => {
          this.processingCallback!(segments).then(resolve).catch(reject);
        });
      });
      return;
    }

    await this.processingCallback(segments);
  }

  /**
   * Start observing segments
   */
  observeSegments(segments: ContentSegment[]): void {
    if (
      !this.state.initialized ||
      !this.state.enabled ||
      !this.observer ||
      this.isDestroyed
    ) {
      return;
    }
    this.observer.observeMultiple(segments);
  }

  /**
   * Stop observing segments
   */
  unobserveSegments(segments: ContentSegment[]): void {
    if (!this.observer || this.isDestroyed) return;
    this.observer.unobserveMultiple(segments);
  }

  /**
   * Set the processing callback
   */
  setProcessingCallback(callback: LazyLoadingCallback): void {
    this.processingCallback = callback;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: LazyLoadingConfig): void {
    if (this.isDestroyed) return;

    const oldConfig = this.config;
    this.config = { ...newConfig };

    // If the enabled state changed
    if (oldConfig.enabled !== newConfig.enabled) {
      this.state.enabled = newConfig.enabled;
      if (!newConfig.enabled) {
        this.stopAllObservation();
        return;
      }
    }

    if (!this.state.initialized || !newConfig.enabled) return;

    if (!this.observer) {
      // Enabled after initialization without an observer
      this.createObserver();
      return;
    }

    // Only a changed preload distance needs a new IntersectionObserver; the
    // observed segments are carried over instead of being dropped.
    if (oldConfig.preloadDistance !== newConfig.preloadDistance) {
      this.observer.updateOptions({
        preloadDistance: newConfig.preloadDistance,
      });
    }
  }

  /**
   * Stop all observation
   */
  private stopAllObservation(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.state.processingQueue.clear();
    this.state.segmentCache.clear();
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }

  // Basic state query methods
  isEnabled(): boolean {
    return this.state.initialized && this.state.enabled;
  }

  isInitialized(): boolean {
    return this.state.initialized;
  }

  getConfig(): Readonly<LazyLoadingConfig> {
    return { ...this.config };
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.stopAllObservation();
    if (this.observer) {
      this.observer.destroy();
      this.observer = null;
    }
  }
}
