/**
 * AI translation provider implementation
 *
 * This class uses an AI LLM API to provide Chinese translations of English words, fully replacing the original Youdao dictionary API,
 * which resolves cross-origin access issues in browser extensions. The provider implements full caching, error handling and
 * timeout control to keep the translation service stable and performant.
 *
 * Key features:
 * - Uses a purpose-built AI prompt to get accurate Chinese definitions
 * - Implements a 24-hour TTL cache (failures: 10 minutes) and in-flight deduplication to reduce API calls
 * - Successful definitions are also kept across tabs and restarts (background IndexedDB, 30 days)
 * - Thorough error handling and timeout control
 * - Supports dynamic API configuration updates
 * - Uses the unified UniversalApiService for API calls
 */

import { AITranslationResult, AITranslationEntry } from '../types';
import { ApiConfigItem } from '../../shared/types/api';
import { API_CONSTANTS } from '../config';
import { cleanMarkdownFromResponse } from '../../../utils';
import { UniversalApiService } from '../../api/services/UniversalApiService';
import { LookupCache, LookupOutcome } from '../utils/LookupCache';
import {
  buildDefinitionFingerprint,
  lookupRememberedDefinition,
  rememberDefinition,
} from './DefinitionMemory';

export class AITranslationProvider {
  /** Provider name identifier */
  readonly name = 'ai-translation';

  /** AI API config item; the id must be kept so requests use an explicit configuration. */
  private apiConfigItem: ApiConfigItem | null;

  /** API request timeout in milliseconds */
  private timeout: number = 0;

  /**
   * In-memory cache of definitions and recent failures; concurrent hovers of
   * the same word share one request
   */
  private readonly lookups = new LookupCache<AITranslationEntry>({
    maxEntries: 500,
  });

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

      // Check the cache (definitions and recent failures)
      const cached = this.lookups.get(cleanWord);
      if (cached) {
        return cached.ok
          ? { success: true, data: cached.data, cached: true }
          : { success: false, error: cached.error };
      }

      const apiConfigItem = this.apiConfigItem;
      const apiConfig = apiConfigItem?.config;

      // Pronunciation translation must use an explicit configuration and must not implicitly fall back to the global active configuration.
      if (!apiConfigItem || !apiConfig) {
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

      const result = await this.lookups.resolve(cleanWord, () =>
        this.requestMeaning(cleanWord, apiConfigItem),
      );

      return result.ok
        ? { success: true, data: result.data, cached: result.cached }
        : { success: false, error: result.error };
    } catch (error) {
      console.error('Failed to get word meaning via AI translation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Request one definition from the AI and classify the outcome for caching
   */
  private async requestMeaning(
    cleanWord: string,
    apiConfigItem: ApiConfigItem,
  ): Promise<LookupOutcome<AITranslationEntry>> {
    const apiConfig = apiConfigItem.config;
    try {
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

      // Persistent cross-tab definitions first; a miss or any failure falls through
      const fingerprint = buildDefinitionFingerprint(
        apiConfigItem,
        systemPrompt,
        {
          temperature: apiConfig.temperature || 0,
          maxTokens: 100,
        },
      );
      const remembered = await lookupRememberedDefinition(
        fingerprint,
        cleanWord,
      );
      if (remembered) {
        return { ok: true, data: remembered, ttlMs: this.cacheTTL };
      }

      // Call the AI via UniversalApiService
      const result = await this.universalApi.call(cleanWord, {
        systemPrompt,
        configId: apiConfigItem.id,
        temperature: apiConfig.temperature || 0,
        maxTokens: 100,
        timeout: this.timeout,
        customParams: apiConfig.customParams,
      });

      if (!result.success) {
        return {
          ok: false,
          error: result.error || 'AI translation request failed',
          ttlMs: API_CONSTANTS.LOOKUP_ERROR_CACHE_TTL,
        };
      }

      const data = this.parseAIResponse(result.content, cleanWord);
      // The "unavailable" placeholder of an empty answer is not persisted
      if (result.content?.trim()) {
        rememberDefinition(fingerprint, cleanWord, data);
      }
      return { ok: true, data, ttlMs: this.cacheTTL };
    } catch (error) {
      console.error('Failed to get word meaning via AI translation:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        ttlMs: API_CONSTANTS.LOOKUP_ERROR_CACHE_TTL,
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
      this.lookups.clear();
    } else {
      // Same model, but key/parameters may have been fixed: retry failures
      this.lookups.clearFailures();
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
}
