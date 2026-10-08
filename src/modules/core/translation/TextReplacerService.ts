/**
 * Text replacer service
 * Replaces words in text according to user settings; supports smart mode and traditional mode
 */

import { ApiServiceFactory } from '../../api';
import { getResponseStatus } from '../../api/utils/apiUtils';
import {
  translationStats,
  type TranslationStatsSnapshot,
} from './TranslationStats';
import { StyleManager } from '../../styles';
import {
  SegmentTranslationCache,
  SEGMENT_CACHE_MAX_ENTRIES,
  buildTranslationCacheKey,
  responseFromOutcome,
  toTranslationOutcome,
  type TranslationOutcome,
} from './SegmentTranslationCache';
import { TRANSLATION_PROMPT_VERSION } from './PromptService';
import {
  ConcurrencyLimiter,
  MAX_CONCURRENT_TRANSLATION_REQUESTS,
} from './ConcurrencyLimiter';
import {
  BatchTranslationExecutor,
  hintWords,
  withHintPairs,
} from './BatchTranslationExecutor';
import {
  TRANSLATION_BATCH_MAX_CHARS,
  TRANSLATION_BATCH_MAX_ITEMS,
  type TranslationHint,
} from '../../processing/ProcessingContracts';

// Replacement result interface
export interface ReplacementResult {
  original: string; // Original text
  replaced: string; // Replaced text
  replacedWords: Array<{
    chinese: string;
    english: string;
    position: {
      start: number;
      end: number;
    };
    isNew: boolean; // whether it is a new word
  }>;
}

// Cache statistics
export interface CacheStats {
  cacheSize: number;
}
import {
  ReplacementConfig,
  FullTextAnalysisResponse,
  BatchAnalysisResponse,
} from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import { TranslationStyle } from '../../shared/types/core';

/**
 * Text replacer service class
 * Singleton that provides unified text replacement
 */
export class TextReplacerService {
  // Singleton instance
  private static instance: TextReplacerService | null = null;

  // Service components
  public readonly styleManager: StyleManager;
  private config: ReplacementConfig;
  private segmentCache: SegmentTranslationCache;
  // One per-tab limiter shared by every run (manual, lazy loading, dynamic content)
  private requestLimiter = new ConcurrencyLimiter(
    MAX_CONCURRENT_TRANSLATION_REQUESTS,
  );

  /**
   * Private constructor, enforces the singleton pattern
   */
  private constructor(config: ReplacementConfig) {
    this.config = config;
    this.styleManager = new StyleManager();
    this.segmentCache = new SegmentTranslationCache(SEGMENT_CACHE_MAX_ENTRIES);
    this.initializeStyleManager();
  }

  /**
   * Get the service instance (singleton)
   */
  public static getInstance(config?: ReplacementConfig): TextReplacerService {
    if (!TextReplacerService.instance) {
      if (!config) {
        throw new Error(
          'A config must be provided when first creating the TextReplacerService instance',
        );
      }
      TextReplacerService.instance = new TextReplacerService(config);
    }
    return TextReplacerService.instance;
  }

  /**
   * Reset the service instance (mainly for testing)
   */
  public static resetInstance(): void {
    TextReplacerService.instance = null;
  }

  /**
   * Initialize the style manager
   */
  private initializeStyleManager(): void {
    const translationStyle =
      this.config.translationStyle || TranslationStyle.DEFAULT;
    this.styleManager.setTranslationStyle(translationStyle);
  }

  /**
   * Update service config
   * @param config new config (partial update)
   */
  public updateConfig(config: Partial<ReplacementConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.translationStyle) {
      this.styleManager.setTranslationStyle(config.translationStyle);
    }
  }

  /**
   * Get current config
   */
  public getConfig(): ReplacementConfig {
    return { ...this.config };
  }

  /**
   * Replace words in text
   * @param text Original text
   * @param hint optional page glossary hint ("already handled" words)
   * @returns replacement result
   */
  public async replaceText(
    text: string,
    hint?: TranslationHint,
  ): Promise<FullTextAnalysisResponse> {
    try {
      // If the API is not used, return the original text directly
      if (!this.config.useGptApi) {
        return this.createEmptyResult(text);
      }

      const settingsForApi = this.buildUserSettings();

      // Handle translation
      return await this.processTranslation(text, settingsForApi, hint);
    } catch (error) {
      console.error('Text replacement failed:', error);
      return this.createErrorResult(text, error);
    }
  }

  /**
   * Replace words in several texts at once.
   * Identical texts, cached and in-flight segments are resolved without new requests; the rest is
   * sent as numbered batch requests (see TRANSLATION_BATCH_MAX_ITEMS / TRANSLATION_BATCH_MAX_CHARS).
   * @param hints optional page glossary hints, one per text
   * @returns one result per input text, in input order
   */
  public async replaceTexts(
    texts: string[],
    hints?: Array<TranslationHint | undefined>,
  ): Promise<FullTextAnalysisResponse[]> {
    if (!this.config.useGptApi) {
      return texts.map((text) => this.createEmptyResult(text));
    }

    try {
      const settings = this.buildUserSettings();

      if (TRANSLATION_BATCH_MAX_ITEMS <= 1) {
        return await Promise.all(
          texts.map((text, index) =>
            this.processTranslation(text, settings, hints?.[index]),
          ),
        );
      }

      const executor = new BatchTranslationExecutor(
        this.segmentCache,
        {
          translateOne: (text, alreadyHandled) =>
            this.requestTranslation(text, settings, alreadyHandled),
          translateMany: (batch, alreadyHandled) =>
            this.callBatchTranslationAPI(batch, settings, alreadyHandled),
        },
        {
          maxItems: TRANSLATION_BATCH_MAX_ITEMS,
          maxChars: TRANSLATION_BATCH_MAX_CHARS,
        },
      );
      const outcomes = await executor.translate(
        texts,
        texts.map((text) => this.generateCacheKey(text, settings)),
        hints,
      );

      return texts.map((text, index) =>
        responseFromOutcome(text, outcomes[index], settings.replacementRate),
      );
    } catch (error) {
      console.error('Batch text replacement failed:', error);
      return texts.map((text) => this.createErrorResult(text, error));
    }
  }

  /**
   * Create an empty replacement result
   */
  private createEmptyResult(text: string): FullTextAnalysisResponse {
    return {
      original: text,
      processed: text,
      replacements: [],
      status: 'empty',
    };
  }

  /**
   * Create a failed result. Failed results are never cached so the segment can be retried later.
   */
  private createErrorResult(
    text: string,
    error: unknown,
  ): FullTextAnalysisResponse {
    return {
      original: text,
      processed: text,
      replacements: [],
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Build user settings for the API call
   */
  private buildUserSettings(): UserSettings {
    return {
      ...this.config.userSettings,
      userLevel: this.config.userLevel,
      replacementRate: this.config.replacementRate,
      useGptApi: this.config.useGptApi,
      translationStyle: this.config.translationStyle,
    };
  }

  /**
   * Unified translation handling method: in-page cache, then in-flight request, then API call.
   * @param text Original text
   * @param settings user settings
   * @param hint optional page glossary hint; its pairs are stored with the answer (see withHintPairs)
   * @returns translation result with positions computed for this exact text
   */
  private async processTranslation(
    text: string,
    settings: UserSettings,
    hint?: TranslationHint,
  ): Promise<FullTextAnalysisResponse> {
    const cacheKey = this.generateCacheKey(text, settings);

    const { outcome, source } = await this.segmentCache.resolve(cacheKey, () =>
      this.requestTranslation(text, settings, hintWords(hint)).then(
        (requested) => withHintPairs(requested, hint),
      ),
    );

    if (source === 'cache') {
      translationStats.recordCacheHit();
    } else if (source === 'inflight') {
      translationStats.recordCoalesced();
    }

    return responseFromOutcome(text, outcome, settings.replacementRate);
  }

  /**
   * Call the API for one segment and reduce the response to a cacheable outcome
   */
  private async requestTranslation(
    text: string,
    settings: UserSettings,
    alreadyHandled?: string[],
  ): Promise<TranslationOutcome> {
    try {
      const apiResult = await this.callTranslationAPI(
        text,
        settings,
        alreadyHandled,
      );
      return toTranslationOutcome({
        ...apiResult,
        status: getResponseStatus(apiResult),
      });
    } catch (error) {
      console.error('Translation failed:', error);
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Call the translation API
   */
  private async callTranslationAPI(
    text: string,
    settings: UserSettings,
    alreadyHandled?: string[],
  ): Promise<FullTextAnalysisResponse> {
    const activeConfig = this.config.activeApiConfig;

    if (!activeConfig) {
      throw new Error('No active API config found');
    }

    // Use the factory method to create the correct provider instance
    const translationProvider = ApiServiceFactory.createProvider(activeConfig);

    // Call the API to translate, capped per tab
    return await this.requestLimiter.run(() =>
      translationProvider.analyzeFullText(
        text,
        settings,
        alreadyHandled ? { alreadyHandled } : undefined,
      ),
    );
  }

  /**
   * Call the batch translation API (numbered segments in one request)
   */
  private async callBatchTranslationAPI(
    texts: string[],
    settings: UserSettings,
    alreadyHandled?: Array<string[] | undefined>,
  ): Promise<BatchAnalysisResponse> {
    const activeConfig = this.config.activeApiConfig;

    if (!activeConfig) {
      throw new Error('No active API config found');
    }

    const translationProvider = ApiServiceFactory.createProvider(activeConfig);
    if (!translationProvider.analyzeBatch) {
      // The executor retries every item with a single request
      return { status: 'error', error: 'Batching not supported', items: [] };
    }

    return await this.requestLimiter.run(() =>
      translationProvider.analyzeBatch!(
        texts,
        settings,
        alreadyHandled ? { alreadyHandled } : undefined,
      ),
    );
  }

  /**
   * Generate the cache key: every setting that changes the model answer plus the normalized text.
   * Full string key (no hash) so different segments can never collide.
   */
  private generateCacheKey(text: string, settings: UserSettings): string {
    const activeConfig = this.config.activeApiConfig;
    const apiConfig = activeConfig?.config ?? this.config.apiConfig;

    return buildTranslationCacheKey(
      {
        providerId: activeConfig?.id ?? '',
        protocolFamily: activeConfig?.protocolFamily,
        endpoint: apiConfig?.apiEndpoint,
        model: apiConfig?.model ?? '',
        temperature: apiConfig?.temperature,
        customParams: apiConfig?.customParams,
        targetLanguage: settings.multilingualConfig.targetLanguage,
        userLevel: settings.userLevel,
        replacementRate: settings.replacementRate,
        promptVersion: TRANSLATION_PROMPT_VERSION,
      },
      text,
    );
  }

  // ==================== Cache management methods ====================

  /**
   * Get cache statistics
   * @returns cache statistics
   */
  public getCacheStats(): CacheStats {
    return {
      cacheSize: this.segmentCache.size,
    };
  }

  /**
   * Per-tab request/token/cache counters (see TranslationStats)
   */
  public getTranslationStats(): TranslationStatsSnapshot {
    return translationStats.getSnapshot();
  }

  /**
   * Clear all cache
   */
  public clearAllCache(): void {
    this.segmentCache.clear();
    console.log('All cache cleared');
  }

  // ==================== Service lifecycle methods ====================

  /**
   * Initialize the service
   */
  public async initialize(): Promise<void> {
    // Warm up the cache or other initialization
    console.log('TextReplacerService initialized');
  }

  /**
   * Destroy service resources
   */
  public dispose(): void {
    this.clearAllCache();
    // Other cleanup
    console.log('TextReplacerService resources cleaned up');
  }
}

// Export the service instance getter (simplifies external use)
export const getTextReplacerService = (config?: ReplacementConfig) => {
  return TextReplacerService.getInstance(config);
};
