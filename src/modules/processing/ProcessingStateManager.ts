/**
 * Global processing state manager
 * Centrally manages all text processing state, prevents duplicate processing, and keeps the system consistent
 */

export interface ProcessedContentInfo {
  /** Content fingerprint */
  fingerprint: string;
  /** Processing timestamp */
  timestamp: number;
  /** DOM path */
  domPath: string;
  /** Processing result summary */
  processingResult: {
    replacementCount: number;
    success: boolean;
  };
}

export interface ContentSegment {
  /** Unique segment identifier */
  id: string;
  /** Text content */
  textContent: string;
  /** Corresponding DOM element */
  element: Element;
  /** All related DOM elements (used for merged segments) */
  elements: Element[];
  /** List of text nodes */
  textNodes: Text[];
  /** Content fingerprint */
  fingerprint: string;
  /** DOM context path */
  domPath: string;
}

/**
 * Global processing state manager
 *
 * Core responsibilities:
 * 1. Track all processed content to prevent duplicate processing
 * 2. Manage in-flight content to avoid concurrency conflicts
 * 3. Provide content fingerprint generation and validation
 * 4. Manage the lifecycle of processing state
 */
export class ProcessingStateManager {
  /** Map of processed content */
  private processedContent = new Map<string, ProcessedContentInfo>();

  /** Set of content currently being processed */
  private activeProcessing = new Set<string>();

  /** Timer for cleaning up processing state */
  private cleanupTimer: number | null = null;

  /** Cleanup interval (2 hours) */
  private readonly CLEANUP_INTERVAL = 2 * 60 * 60 * 1000;

  /** Content validity period (4 hours) */
  private readonly CONTENT_TTL = 4 * 60 * 60 * 1000;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Generate a content fingerprint.
   * The fingerprint must be deterministic: the same text at the same DOM position must always yield the same value.
   * Dynamic content is told apart by DOM path and text; do not put time into the fingerprint, or content will be processed repeatedly.
   */
  generateContentFingerprint(textContent: string, domPath: string): string {
    const normalizedText = textContent.trim().replace(/\s+/g, ' ');
    const combinedString = `${normalizedText}|${domPath}`;

    // Use a simple but effective hash algorithm
    let hash = 0;
    for (let i = 0; i < combinedString.length; i++) {
      const char = combinedString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // convert to a 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * Generate the DOM path
   * Generate a unique DOM path identifier for the element
   */
  generateDomPath(element: Element): string {
    const path: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // Add class names (if any and not processing-related)
      const classList = Array.from(current.classList)
        .filter((cls) => !cls.startsWith('wxt-'))
        .slice(0, 2); // limit the number of class names

      if (classList.length > 0) {
        selector += '.' + classList.join('.');
      }

      // Add position info (if there are several siblings of the same type)
      const siblings = current.parentElement?.children;
      if (siblings && siblings.length > 1) {
        const index = Array.from(siblings).indexOf(current);
        selector += `:nth-child(${index + 1})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  /**
   * Check whether content has already been processed
   */
  isContentProcessed(fingerprint: string): boolean {
    const info = this.processedContent.get(fingerprint);
    if (!info) return false;

    // Check whether it has expired
    const now = Date.now();
    if (now - info.timestamp > this.CONTENT_TTL) {
      this.processedContent.delete(fingerprint);
      return false;
    }

    return true;
  }

  /**
   * Check whether content is currently being processed
   */
  isContentProcessing(fingerprint: string): boolean {
    return this.activeProcessing.has(fingerprint);
  }

  /**
   * Mark content as started processing
   */
  markProcessingStart(fingerprint: string): boolean {
    if (
      this.isContentProcessed(fingerprint) ||
      this.isContentProcessing(fingerprint)
    ) {
      return false; // already processed or being processed
    }

    this.activeProcessing.add(fingerprint);
    return true;
  }

  /**
   * Mark content processing as complete
   */
  markProcessingComplete(
    fingerprint: string,
    domPath: string,
    replacementCount: number,
    success: boolean = true,
  ): void {
    // Remove the in-progress mark
    this.activeProcessing.delete(fingerprint);

    // Add to the processed list
    this.processedContent.set(fingerprint, {
      fingerprint,
      timestamp: Date.now(),
      domPath,
      processingResult: {
        replacementCount,
        success,
      },
    });
  }

  /**
   * Mark content processing as failed
   */
  markProcessingFailed(fingerprint: string, domPath: string): void {
    this.markProcessingComplete(fingerprint, domPath, 0, false);
  }

  /**
   * Release the in-progress mark without recording the content as processed,
   * so a failed (e.g. network or API error) segment can be retried later.
   */
  releaseProcessing(fingerprint: string): void {
    this.activeProcessing.delete(fingerprint);
  }

  /**
   * Get processing statistics
   */
  getProcessingStats(): {
    processedCount: number;
    activeCount: number;
    successRate: number;
    totalReplacements: number;
  } {
    const processed = Array.from(this.processedContent.values());
    const successful = processed.filter(
      (info) => info.processingResult.success,
    );
    const totalReplacements = processed.reduce(
      (sum, info) => sum + info.processingResult.replacementCount,
      0,
    );

    return {
      processedCount: processed.length,
      activeCount: this.activeProcessing.size,
      successRate:
        processed.length > 0 ? successful.length / processed.length : 0,
      totalReplacements,
    };
  }

  /**
   * Clean up expired processing state
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [fingerprint, info] of this.processedContent.entries()) {
      if (now - info.timestamp > this.CONTENT_TTL) {
        expired.push(fingerprint);
      }
    }

    expired.forEach((fingerprint) => {
      this.processedContent.delete(fingerprint);
    });

    // Silently clean up expired state
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = window.setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Manually trigger cleanup
   */
  forceCleanup(): void {
    this.cleanup();
  }

  /**
   * Reset all state (for testing or emergencies)
   */
  reset(): void {
    this.processedContent.clear();
    this.activeProcessing.clear();
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.reset();
  }
}

// Global singleton instance
export const globalProcessingState = new ProcessingStateManager();
