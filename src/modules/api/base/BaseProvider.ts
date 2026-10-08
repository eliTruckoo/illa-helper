/**
 * Base translation provider abstract class
 */

import { ApiConfig, FullTextAnalysisResponse } from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import { ITranslationProvider } from '../types';
import {
  validateInputs,
  createErrorResponse,
  createEmptyResponse,
  getResponseStatus,
} from '../utils/apiUtils';
import { translationStats } from '../../core/translation/TranslationStats';

/**
 * Base provider abstract class
 * Provides shared functionality and error handling
 */
export abstract class BaseProvider implements ITranslationProvider {
  protected config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  /**
   * Analyze full text - template method
   */
  async analyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse> {
    const originalText = text || '';

    // Nothing to translate is a successful empty result, not a failure
    if (!originalText.trim()) {
      return createEmptyResponse(originalText);
    }

    // Validate input
    if (!validateInputs(originalText, this.config.apiKey)) {
      return createErrorResponse(originalText, 'API key is not configured');
    }

    try {
      translationStats.recordRequest(1);
      const result = await this.doAnalyzeFullText(originalText, settings);
      return { ...result, status: getResponseStatus(result) };
    } catch (error: any) {
      translationStats.recordError();
      console.error(`${this.getProviderName()} API request failed:`, error);
      return createErrorResponse(
        originalText,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Concrete analysis logic that subclasses must implement
   */
  protected abstract doAnalyzeFullText(
    text: string,
    settings: UserSettings,
  ): Promise<FullTextAnalysisResponse>;

  /**
   * Get the provider name (used for logging)
   */
  protected abstract getProviderName(): string;

  /**
   * Record provider-reported token usage for the per-tab statistics
   */
  protected recordUsage(usage: unknown): void {
    translationStats.recordUsage(usage);
  }

  /**
   * Get configuration
   */
  protected getConfig(): ApiConfig {
    return this.config;
  }
}
