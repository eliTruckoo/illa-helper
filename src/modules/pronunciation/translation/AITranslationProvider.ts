/**
 * AI translation provider implementation
 *
 * This class uses an AI LLM API to provide Chinese translations of English words, fully replacing the original Youdao dictionary API,
 * which resolves cross-origin access issues in browser extensions. The provider implements full caching, error handling and
 * timeout control to keep the translation service stable and performant.
 *
 * Key features:
 * - Uses a purpose-built AI prompt to get accurate Chinese definitions
 * - Implements a 24-hour TTL cache to reduce API calls
 * - Thorough error handling and timeout control
 * - Supports dynamic API configuration updates
 * - Uses the unified UniversalApiService for API calls
 */

import { AITranslationResult, AITranslationEntry, CacheEntry } from '../types';
import { ApiConfigItem } from '../../shared/types/api';
import { API_CONSTANTS } from '../config';
import { cleanMarkdownFromResponse } from '../../../utils';
import { UniversalApiService } from '../../api/services/UniversalApiService';

export class AITranslationProvider {
  /** Provider name identifier */
  readonly name = 'ai-translation';

  /** AI API config item; the id must be kept so requests use an explicit configuration. */
  private apiConfigItem: ApiConfigItem | null;

  /** API request timeout in milliseconds */
  private timeout: number = 0;

  /** In-memory cache that stores translation results to reduce API calls */
  private cache = new Map<string, CacheEntry<AITranslationEntry>>();

  /** Cache time-to-live, 24-hour TTL */
  private readonly cacheTTL = API_CONSTANTS.AI_TRANSLATION_CACHE_TTL;

  /** UniversalApiService instance */
  private universalApi: UniversalApiService;

  /**
   * Constructor
   *
   * @param apiConfigItem - AI API config item, including config ID, protocol family and request config
   * @param timeout - API request timeout in milliseconds, default 0 (unlimited)
   */
  constructor(apiConfigItem: ApiConfigItem | null, timeout: number = 0) {
    this.apiConfigItem = apiConfigItem;
    this.timeout = timeout;
    this.universalApi = UniversalApiService.getInstance();
  }

  /**
   * Get the Chinese definition of a word
   *
   * This is the core function of the AI translation provider. It calls UniversalApiService to get the
   * Chinese definition of an English word, with full caching, error handling and timeout control.
   *
   * Processing flow:
   * 1. Validate input parameters and clean the text
   * 2. Check the in-memory cache and return immediately on a hit
   * 3. Call the AI via UniversalApiService to get the translation
   * 4. Parse the response and store it in the cache
   *
   * @param word - The English word to translate
   * @returns Promise<AITranslationResult> - Translation result, including success status, data and cache flag
   */
  async getMeaning(word: string): Promise<AITranslationResult> {
    try {
      // Validate data
      if (!word || typeof word !== 'string') {
        return {
          success: false,
          error: 'Invalid word parameter',
        };
      }

      const cleanWord = word.toLowerCase().trim();

      // Check the cache
      const cached = this.getFromCache(cleanWord);
      if (cached) {
        return {
          success: true,
          data: cached,
          cached: true,
        };
      }

      const apiConfig = this.apiConfigItem?.config;

      // Pronunciation translation must use an explicit configuration and must not implicitly fall back to the global active configuration.
      if (!this.apiConfigItem || !apiConfig) {
        return {
          success: false,
          error: 'No usable AI API configuration found',
        };
      }

      // Validate the API configuration
      if (!apiConfig.apiKey) {
        return {
          success: false,
          error: 'AI API configuration incomplete: missing API Key',
        };
      }

      // Build the AI prompt dedicated to word translation
      const systemPrompt = `You are a professional English dictionary assistant. Provide accurate, concise Chinese definitions for the user.
Requirements:
1. Return only the Chinese definition of the word, in the format: part of speech + definition
2. If there are multiple parts of speech, separate them with semicolons
3. Keep definitions concise and accurate, suitable for quick understanding
4. Do not include example sentences or any other extra information
5. Return plain text, not JSON

Examples:
Input: hello
Output: interj. \u4f60\u597d\uff1bn. \u6253\u62db\u547c

Input: beautiful
Output: adj. \u7f8e\u4e3d\u7684\uff0c\u6f02\u4eae\u7684`;

      // Call the AI via UniversalApiService
      const result = await this.universalApi.call(cleanWord, {
        systemPrompt,
        configId: this.apiConfigItem.id,
        temperature: apiConfig.temperature || 0,
        maxTokens: 100,
        timeout: this.timeout,
        customParams: apiConfig.customParams,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'AI translation request failed',
        };
      }

      // Parse the AI response
      const meaningInfo = this.parseAIResponse(result.content, cleanWord);

      // Store in the cache
      this.setCache(cleanWord, meaningInfo);

      return {
        success: true,
        data: meaningInfo,
        cached: false,
      };
    } catch (error) {
      console.error('Failed to get word meaning via AI translation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check whether the provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check the API configuration
      if (!this.apiConfigItem?.config?.apiKey) {
        return false;
      }

      return await this.universalApi.isAvailable(this.apiConfigItem.id);
    } catch {
      return false;
    }
  }

  /**
   * Get the provider configuration
   */
  getConfig() {
    return {
      endpoint: this.apiConfigItem?.config.apiEndpoint,
      rateLimitPerMinute: 20, // AI APIs usually have a low rate limit
      supportsBatch: false,
      supportsAudio: false,
      supportsMeaning: true, // Main feature
    };
  }

  /**
   * Update the API configuration and timeout
   */
  updateApiConfig(apiConfigItem: ApiConfigItem | null, timeout?: number): void {
    const previousKey = this.getCacheScopeKey();
    this.apiConfigItem = apiConfigItem;
    if (timeout !== undefined) {
      this.timeout = timeout;
    }
    if (previousKey !== this.getCacheScopeKey()) {
      this.cache.clear();
    }
  }

  private getCacheScopeKey(): string {
    const config = this.apiConfigItem?.config;
    return this.apiConfigItem
      ? `${this.apiConfigItem.id}:${config?.apiEndpoint || ''}:${config?.model || ''}`
      : 'none';
  }

  /**
   * Parse the AI response content
   */
  private parseAIResponse(content: string, word: string): AITranslationEntry {
    try {
      let explain = content?.trim() || '';

      // Clean and validate the explanation text
      if (!explain || typeof explain !== 'string') {
        explain = `Definition for ${word} is currently unavailable`;
      } else {
        // Clean Markdown and text formatting
        explain = cleanMarkdownFromResponse(explain);
        // If the explanation is too long, truncate it to the first 200 characters
        if (explain.length > 200) {
          explain = explain.substring(0, 200) + '...';
        }
      }

      return {
        explain: explain,
        source: 'ai-translation',
      };
    } catch (error) {
      console.error('Failed to parse AI translation response:', error);
      return {
        explain: `Definition for ${word} is currently unavailable`,
        source: 'ai-translation',
      };
    }
  }

  /**
   * Get data from the cache
   */
  private getFromCache(word: string): AITranslationEntry | null {
    const entry = this.cache.get(word);
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data;
    }

    // Clean up expired cache entries
    if (entry) {
      this.cache.delete(word);
    }

    return null;
  }

  /**
   * Store data in the cache
   */
  private setCache(word: string, data: AITranslationEntry): void {
    this.cache.set(word, {
      data,
      timestamp: Date.now(),
      ttl: this.cacheTTL,
    });

    // Simple cache size control
    if (this.cache.size > 500) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }
}
