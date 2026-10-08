/**
 * Base translation provider abstract class
 */

import { ApiConfig, FullTextAnalysisResponse } from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import { ITranslationProvider } from '../types';
import { validateInputs, createErrorResponse } from '../utils/apiUtils';

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

    // Validate input
    if (!validateInputs(originalText, this.config.apiKey)) {
      return createErrorResponse(originalText);
    }

    try {
      return await this.doAnalyzeFullText(originalText, settings);
    } catch (error: any) {
      console.error(`${this.getProviderName()} API request failed:`, error);
      return createErrorResponse(originalText);
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
   * Get configuration
   */
  protected getConfig(): ApiConfig {
    return this.config;
  }
}
