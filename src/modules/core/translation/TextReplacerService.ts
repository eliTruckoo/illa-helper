/**
 * Text replacer service
 * Replaces words in text according to user settings; supports smart mode and traditional mode
 */

import { ApiServiceFactory } from '../../api';
import { StyleManager } from '../../styles';

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

// Cache key interface
interface CacheKey {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  userLevel: number;
  replacementRate: number;
}

// Cache statistics
export interface CacheStats {
  cacheSize: number;
}
import {
  ReplacementConfig,
  FullTextAnalysisResponse,
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

  // Cache config constants
  private static readonly CACHE_MAX_SIZE = 100;
  private static readonly CACHE_CLEANUP_BATCH = 20;

  // Service components
  public readonly styleManager: StyleManager;
  private config: ReplacementConfig;
  private cache: Map<string, FullTextAnalysisResponse>;

  /**
   * Private constructor, enforces the singleton pattern
   */
  private constructor(config: ReplacementConfig) {
    this.config = config;
    this.styleManager = new StyleManager();
    this.cache = new Map<string, FullTextAnalysisResponse>();
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
   * @returns replacement result
   */
  public async replaceText(text: string): Promise<FullTextAnalysisResponse> {
    try {
      // If the API is not used, return the original text directly
      if (!this.config.useGptApi) {
        return this.createEmptyResult(text);
      }

      const settingsForApi = this.buildUserSettings();

      // Handle translation
      return await this.processTranslation(text, settingsForApi);
    } catch (error) {
      console.error('Text replacement failed:', error);
      return this.createEmptyResult(text);
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
   * Unified translation handling method
   * @param text Original text
   * @param settings user settings
   * @returns translation result
   */
  private async processTranslation(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    // Generate cache key
    const cacheKey = this.generateCacheKey(text, settings);

    // Check cache
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      // Get API result
      const apiResult = await this.callTranslationAPI(text, settings);

      // Store in cache
      this.setCachedResult(cacheKey, apiResult);

      return apiResult;
    } catch (error) {
      console.error('Translation failed:', error);
      return await this.handleTranslationError(text, settings, error);
    }
  }

  /**
   * Call the translation API
   */
  private async callTranslationAPI(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    const activeConfig = this.config.activeApiConfig;

    if (!activeConfig) {
      throw new Error('No active API config found');
    }

    // Use the factory method to create the correct provider instance
    const translationProvider = ApiServiceFactory.createProvider(activeConfig);

    // Call the API to translate
    return await translationProvider.analyzeFullText(text, settings);
  }

  /**
   * Handle translation errors - simplified
   */
  private async handleTranslationError(
    text: string,
    settings: UserSettings,
    error: any,
  ): Promise<FullTextAnalysisResponse> {
    console.log('Translation failed, returning original text:', error);

    // No fallback logic after simplification, return the original text directly
    return this.createEmptyResult(text);
  }

  /**
   * Generate cache key
   * @param text text
   * @param settings settings
   * @returns cache key string
   */
  private generateCacheKey(text: string, settings: UserSettings): string {
    const targetLanguage = settings.multilingualConfig.targetLanguage;

    const keyData: CacheKey = {
      text: text.trim(),
      targetLanguage: targetLanguage,
      userLevel: settings.userLevel,
      replacementRate: settings.replacementRate,
    };

    return this.hashCacheKey(keyData);
  }

  /**
   * Generate a hash of the cache key
   */
  private hashCacheKey(keyData: CacheKey): string {
    const str = JSON.stringify(keyData);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // ==================== Cache management methods ====================

  /**
   * Get cached result
   */
  private getCachedResult(cacheKey: string): FullTextAnalysisResponse | null {
    return this.cache.get(cacheKey) || null;
  }

  /**
   * Set cached result
   */
  private setCachedResult(
    cacheKey: string,
    result: FullTextAnalysisResponse,
  ): void {
    this.cache.set(cacheKey, result);
    this.cleanupCache();
  }

  /**
   * Clean up expired cache
   */
  private cleanupCache(): void {
    if (this.cache.size > TextReplacerService.CACHE_MAX_SIZE) {
      const keys = Array.from(this.cache.keys());
      const deleteCount =
        this.cache.size -
        TextReplacerService.CACHE_MAX_SIZE +
        TextReplacerService.CACHE_CLEANUP_BATCH;

      for (let i = 0; i < deleteCount; i++) {
        this.cache.delete(keys[i]);
      }

      console.log(`Cache cleanup: removed ${deleteCount} entries`);
    }
  }

  /**
   * Get cache statistics
   * @returns cache statistics
   */
  public getCacheStats(): CacheStats {
    return {
      cacheSize: this.cache.size,
    };
  }

  /**
   * Clear all cache
   */
  public clearAllCache(): void {
    this.cache.clear();
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
