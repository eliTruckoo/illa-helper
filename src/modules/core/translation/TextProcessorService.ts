/**
 * Text processor service
 * Traverses the DOM, extracts text nodes and processes them
 */

import {
  OriginalWordDisplayMode,
  TranslationPosition,
} from '../../shared/types/core';
import { ApiConfigItem } from '../../shared/types/api';
import { PronunciationService } from '../../pronunciation/services/PronunciationService';
import { DEFAULT_PRONUNCIATION_CONFIG } from '../../pronunciation/config';
import { ContentSegmenter } from '../../processing/ContentSegmenter';
import { ProcessingCoordinator } from '../../processing/ProcessingCoordinator';
import { globalProcessingState } from '../../processing/ProcessingStateManager';
import { ReplacementBudget } from '../../processing/ReplacementBudget';
import type { TextReplacementEngine } from '../../processing/ProcessingContracts';

// Content segmentation configuration
export interface SegmentConfig {
  maxSegmentLength: number;
  minSegmentLength: number;
  mergeSmallSegments: boolean;
}

// Processing statistics
export interface ProcessingStats {
  coordinator: any; // coordinator statistics
  global: any; // global statistics
}

// Text processor service configuration
export interface TextProcessorConfig {
  enablePronunciationTooltip?: boolean;
  apiConfigItem?: ApiConfigItem | null;
  segmentConfig?: Partial<SegmentConfig>;
}

/**
 * Text processor service class
 * Uses the singleton pattern and provides unified DOM text processing
 */
export class TextProcessorService {
  // Singleton instance
  private static instance: TextProcessorService | null = null;

  // Service components
  private pronunciationService!: PronunciationService;
  private contentSegmenter!: ContentSegmenter;
  private processingCoordinator!: ProcessingCoordinator;
  private config: TextProcessorConfig;

  /**
   * Private constructor, ensures the singleton pattern
   */
  private constructor(config: TextProcessorConfig = {}) {
    this.config = {
      enablePronunciationTooltip: true,
      ...config,
    };

    this.initializeServices();
    this.injectGlowStyle();
  }

  /**
   * Get the service instance (singleton pattern)
   */
  public static getInstance(
    config?: TextProcessorConfig,
  ): TextProcessorService {
    if (!TextProcessorService.instance) {
      TextProcessorService.instance = new TextProcessorService(config);
    }
    return TextProcessorService.instance;
  }

  /**
   * Reset the service instance (mainly for testing)
   */
  public static resetInstance(): void {
    TextProcessorService.instance = null;
  }

  /**
   * Initialize service components
   */
  private initializeServices(): void {
    // Create the pronunciation service configuration
    const pronunciationConfig = {
      ...DEFAULT_PRONUNCIATION_CONFIG,
      uiConfig: {
        ...DEFAULT_PRONUNCIATION_CONFIG.uiConfig,
        tooltipEnabled: this.config.enablePronunciationTooltip ?? true,
      },
    };

    // Initialize each service component
    this.pronunciationService = new PronunciationService(
      pronunciationConfig,
      this.config.apiConfigItem ?? null,
    );
    this.contentSegmenter = new ContentSegmenter();
    this.processingCoordinator = new ProcessingCoordinator(
      this.pronunciationService,
    );
  }

  /**
   * Inject styles
   * Add the CSS styles required for text processing
   */
  private injectGlowStyle(): void {
    if ((window as any).wxtGlowStyleInjected) return;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes wxt-glow-animation {
        from {
          background-color: rgba(106, 136, 224, 0.3);
          box-shadow: 0 0 8px rgba(106, 136, 224, 0.5);
        }
        to {
          background-color: transparent;
          box-shadow: 0 0 0 transparent;
        }
      }
      .wxt-glow {
        animation: wxt-glow-animation 0.8s ease-out;
        border-radius: 3px;
      }
      .wxt-original-word--learning {
        filter: blur(5px);
        cursor: pointer;
        transition: filter 0.2s ease-in-out;
      }

      .wxt-original-word--learning:hover {
        filter: blur(0) !important;
      }

      /* Enhance hover support for learning mode inside a tags */
      a .wxt-original-word--learning:hover,
      a:hover .wxt-original-word--learning {
        filter: blur(0) !important;
      }

      /* Phonetic error message styles */
      .wxt-phonetic-error {
        font-family: 'SF Mono', 'Monaco', 'Consolas', 'Roboto Mono', monospace;
        font-size: 13px;
        color: #ff9999;
        font-style: italic;
        font-weight: 500;
        background: linear-gradient(135deg, rgba(255, 153, 153, 0.1) 0%, rgba(255, 153, 153, 0.05) 100%);
        padding: 4px 8px;
        border-radius: 6px;
        display: inline-block;
        border: 1px solid rgba(255, 153, 153, 0.3);
        letter-spacing: 0.02em;
        opacity: 0.8;
      }

      /* Nested word tooltip title row layout */
      .wxt-word-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .wxt-word-title-row .wxt-word-main {
        flex: 1;
      }

      .wxt-word-title-row .wxt-accent-buttons {
        flex-shrink: 0;
      }
      @keyframes wxt-processing-animation {
        0% {
          background-color: rgba(106, 136, 224, 0.1);
        }
        50% {
          background-color: rgba(106, 136, 224, 0.3);
        }
        100% {
          background-color: rgba(106, 136, 224, 0.1);
        }
      }
      .wxt-processing {
        animation: wxt-processing-animation 2s infinite ease-in-out;
        border-radius: 3px;
        transition: background-color 0.3s ease-out;
        pointer-events: none !important;
      }
      
      /* Ensure link elements remain clickable while being processed */
      a.wxt-processing,
      a.wxt-processing *,
      .wxt-processing a,
      .wxt-processing a * {
        pointer-events: auto !important;
        cursor: pointer !important;
      }
      
      /* Ensure button elements remain clickable while being processed */
      button.wxt-processing,
      button.wxt-processing *,
      .wxt-processing button,
      .wxt-processing button * {
        pointer-events: auto !important;
        cursor: pointer !important;
      }
      
      /* Ensure clickable elements remain clickable while being processed */
      [onclick].wxt-processing,
      [onclick].wxt-processing *,
      .wxt-processing [onclick],
      .wxt-processing [onclick] * {
        pointer-events: auto !important;
        cursor: pointer !important;
      }
    `;

    document.head.appendChild(style);
    (window as any).wxtGlowStyleInjected = true;
  }

  // =================================================================
  // Core Processing Flow
  // =================================================================

  /**
   * Process the root node
   * Main text processing entry point, supports smart segmentation and unified processing
   * @param root root node
   * @param textReplacer text replacer
   * @param originalWordDisplayMode original word display mode
   * @param maxLength maximum processing length
   * @param translationPosition translation position
   * @param showParentheses whether to show parentheses
   */
  public async processRoot(
    root: Node,
    textReplacer: TextReplacementEngine,
    originalWordDisplayMode: OriginalWordDisplayMode,
    maxLength: number = 400,
    translationPosition: TranslationPosition,
    showParentheses: boolean,
    replacementBudget?: ReplacementBudget,
  ): Promise<void> {
    try {
      // Update the content segmenter configuration
      this.updateSegmentConfig({
        maxSegmentLength: maxLength,
        minSegmentLength: 20,
        mergeSmallSegments: false,
      });

      // Use the smart segmenter to split the root node into content segments
      const segments = await this.contentSegmenter.segmentContent(root);
      if (segments.length === 0) {
        return;
      }

      const activeBudget =
        replacementBudget ??
        ReplacementBudget.fromSegments(
          segments,
          textReplacer.getConfig().replacementRate,
        );

      // Use the processing coordinator for unified processing
      await this.processingCoordinator.processSegments(
        segments,
        textReplacer,
        originalWordDisplayMode,
        translationPosition,
        showParentheses,
        false, // isLazyLoading
        activeBudget,
      );
    } catch (error) {
      console.warn('An error occurred during text processing:', error);
      // Handle errors silently so the page keeps working normally
    }
  }

  // =================================================================
  // Configuration Management
  // =================================================================

  /**
   * Update the service configuration
   * @param config new configuration (partial update)
   */
  public updateConfig(config: Partial<TextProcessorConfig>): void {
    this.config = { ...this.config, ...config };

    // If the API configuration changed, the pronunciation service must be updated
    if ('apiConfigItem' in config) {
      this.updateApiConfig(config.apiConfigItem ?? null);
    }
  }

  /**
   * Get the current configuration
   */
  public getConfig(): TextProcessorConfig {
    return { ...this.config };
  }

  /**
   * Update the segmentation configuration
   * @param segmentConfig segmentation configuration
   */
  public updateSegmentConfig(segmentConfig: Partial<SegmentConfig>): void {
    this.contentSegmenter.updateConfig(segmentConfig);
  }

  /**
   * Update the API configuration
   * Supports runtime API configuration updates; changes take effect immediately
   * @param apiConfigItem API configuration item
   */
  public updateApiConfig(apiConfigItem: ApiConfigItem | null): void {
    try {
      if (this.pronunciationService) {
        this.pronunciationService.updateApiConfig(apiConfigItem);
      }

      // Update the internal configuration
      this.config.apiConfigItem = apiConfigItem;
    } catch (error) {
      console.warn(
        'An error occurred while updating the API configuration:',
        error,
      );
    }
  }

  // =================================================================
  // Statistics & Monitoring
  // =================================================================

  /**
   * Get processing statistics
   * @returns processing statistics data
   */
  public getProcessingStats(): ProcessingStats {
    return {
      coordinator: this.processingCoordinator.getStats(),
      global: globalProcessingState.getProcessingStats(),
    };
  }

  /**
   * Reset processing statistics
   */
  public resetStats(): void {
    this.processingCoordinator.resetStats();
    globalProcessingState.reset();
  }

  // =================================================================
  // Service Lifecycle
  // =================================================================

  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    // Async initialization logic can be added here
    console.log('TextProcessorService initialized');
  }

  /**
   * Destroy service resources
   */
  public dispose(): void {
    this.resetStats();
    // Clean up other resources
    console.log('TextProcessorService resources cleaned up');
  }

  // =================================================================
  // Utility Methods
  // =================================================================

  /**
   * Check whether the service is ready
   */
  public isReady(): boolean {
    return !!(
      this.pronunciationService &&
      this.contentSegmenter &&
      this.processingCoordinator
    );
  }

  /**
   * Get the service status
   */
  public getStatus(): {
    isReady: boolean;
    stats: ProcessingStats;
    config: TextProcessorConfig;
  } {
    return {
      isReady: this.isReady(),
      stats: this.getProcessingStats(),
      config: this.getConfig(),
    };
  }

  /**
   * Get the pronunciation service instance
   * @returns pronunciation service instance
   */
  public getPronunciationService(): PronunciationService | undefined {
    return this.pronunciationService;
  }
}

// Export the service instance getter (simplifies external usage)
export const getTextProcessorService = (config?: TextProcessorConfig) => {
  return TextProcessorService.getInstance(config);
};
