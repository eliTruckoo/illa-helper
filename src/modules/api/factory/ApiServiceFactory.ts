/**
 * API service factory
 */

import { ApiConfigItem } from '../../shared/types/api';
import { ApiProtocolFamily } from '../../shared/types/api';
import { ITranslationProvider } from '../types';
import { GoogleGeminiProvider, OpenAIProvider } from '../providers';

/**
 * API service factory
 * Creates the appropriate translation provider based on configuration
 */
export class ApiServiceFactory {
  /**
   * Create a translation provider instance
   */
  static createProvider(activeConfig: ApiConfigItem): ITranslationProvider {
    const { protocolFamily, config } = activeConfig;

    switch (protocolFamily) {
      case ApiProtocolFamily.OPENAI_COMPATIBLE:
        return new OpenAIProvider(config);
      case ApiProtocolFamily.GEMINI:
        return new GoogleGeminiProvider(config);
      default:
        throw new Error(`Unsupported API protocol family: ${protocolFamily}`);
    }
  }
}
