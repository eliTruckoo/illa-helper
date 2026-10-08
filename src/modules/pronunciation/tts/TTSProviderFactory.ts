/**
 * TTS provider factory
 * Creates and manages different TTS provider instances
 */

import { ITTSProvider, TTSProviderConfig } from './ITTSProvider';
import { WebSpeechTTSProvider } from './WebSpeechTTSProvider';
import { YoudaoTTSProvider } from './YoudaoTTSProvider';
import { TTSProviderType } from '../types';

export class TTSProviderFactory {
  /**
   * Create a TTS provider instance
   * @param providerType provider type
   * @param config configuration parameters
   * @returns TTS provider instance
   */
  static createProvider(
    providerType: TTSProviderType,
    config?: TTSProviderConfig,
  ): ITTSProvider {
    switch (providerType) {
      case 'web-speech':
        return new WebSpeechTTSProvider(config);

      case 'youdao':
        return new YoudaoTTSProvider(config);

      default:
        throw new Error(`Unsupported TTS provider type: ${providerType}`);
    }
  }

  /**
   * Get all supported provider types
   */
  static getSupportedProviders(): TTSProviderType[] {
    return ['web-speech', 'youdao'];
  }

  /**
   * Check whether the provider type is supported
   * @param providerType provider type
   */
  static isProviderSupported(
    providerType: string,
  ): providerType is TTSProviderType {
    return this.getSupportedProviders().includes(
      providerType as TTSProviderType,
    );
  }

  /**
   * Get the display name of the provider
   * @param providerType provider type
   */
  static getProviderDisplayName(providerType: TTSProviderType): string {
    const displayNames: Record<TTSProviderType, string> = {
      'web-speech': 'Browser Speech',
      youdao: 'Youdao Dictionary',
    };

    return displayNames[providerType] || providerType;
  }

  /**
   * Get the description of the provider
   * @param providerType provider type
   */
  static getProviderDescription(providerType: TTSProviderType): string {
    const descriptions: Record<TTSProviderType, string> = {
      'web-speech':
        'Uses the browser built-in speech synthesis, supporting multiple languages and voices',
      youdao:
        'Uses the Youdao Dictionary online speech service, supporting American and British pronunciation',
    };

    return descriptions[providerType] || '';
  }
}
