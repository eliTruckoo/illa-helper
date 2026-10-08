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

    // Glow/processing/learning styles live in the shared main stylesheet
    // injected once by StyleManager.
    this.initializeServices();
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
