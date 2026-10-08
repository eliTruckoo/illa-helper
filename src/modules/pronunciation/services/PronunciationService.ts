/**
 * Main pronunciation service class.
 *
 * Keeps the original pronunciation facade: register elements, query phonetics, speak, and update API/TTS/UI configuration.
 * The tooltip DOM lifecycle and mouse interaction have moved down into TooltipInteractionController.
 */

import { IPhoneticProvider, PhoneticProviderFactory } from '../phonetic';
import { ITTSProvider, TTSProviderFactory } from '../tts';
import { AITranslationProvider } from '../translation';
import { TooltipRenderer, TooltipInteractionController } from '../ui';
import { PhoneticResult, TTSResult } from '../types';
import { PronunciationConfig, DEFAULT_PRONUNCIATION_CONFIG } from '../config';
import { ApiConfigItem } from '../../shared/types/api';
import { StorageService } from '../../core/storage';
import { OriginalWordDisplayMode } from '../../shared/types/core';

export class PronunciationService {
  private config: PronunciationConfig;
  private phoneticProvider: IPhoneticProvider;
  private ttsProvider: ITTSProvider;
  private fallbackTTSProvider: ITTSProvider;
  private aiTranslationProvider: AITranslationProvider;
  private tooltipRenderer: TooltipRenderer;
  private tooltipController: TooltipInteractionController;
  private storageService: StorageService;

  constructor(
    config?: Partial<PronunciationConfig>,
    apiConfigItem?: ApiConfigItem | null,
  ) {
    this.config = { ...DEFAULT_PRONUNCIATION_CONFIG, ...config };
    this.phoneticProvider = PhoneticProviderFactory.getDefaultProvider();
    this.ttsProvider = TTSProviderFactory.createProvider(
      this.config.ttsConfig.provider,
      this.config.ttsConfig,
    );
    this.fallbackTTSProvider = TTSProviderFactory.createProvider('web-speech', {
      lang: this.config.ttsConfig.lang,
      rate: this.config.ttsConfig.rate,
      pitch: this.config.ttsConfig.pitch,
      volume: this.config.ttsConfig.volume,
    });
    this.aiTranslationProvider = new AITranslationProvider(
      apiConfigItem ?? null,
    );
    this.tooltipRenderer = new TooltipRenderer(
      this.config.uiConfig,
      OriginalWordDisplayMode.HIDDEN,
    );
    this.storageService = StorageService.getInstance();
    this.tooltipController = new TooltipInteractionController({
      getConfig: () => this.config,
      phoneticProvider: this.phoneticProvider,
      translationProvider: this.aiTranslationProvider,
      renderer: this.tooltipRenderer,
      storageService: this.storageService,
      speakText: (text) => this.speakText(text),
      speakTextWithAccent: (text, lang) => this.speakTextWithAccent(text, lang),
    });

    void this.updateOriginalWordDisplayMode();
  }

  /**
   * Add pronunciation functionality to a translated element.
   */
  async addPronunciationToElement(
    element: HTMLElement,
    word: string,
    isPhrase?: boolean,
  ): Promise<boolean> {
    return this.tooltipController.register(element, word, isPhrase);
  }

  /**
   * Remove pronunciation functionality from an element.
   */
  removePronunciationFromElement(element: HTMLElement): void {
    this.tooltipController.unregister(element);
  }

  /**
   * Get phonetic information for a word.
   */
  async getPhonetic(word: string): Promise<PhoneticResult> {
    return this.phoneticProvider.getPhonetic(word);
  }

  /**
   * Speak text. Falls back to Web Speech if the primary TTS fails.
   */
  async speakText(text: string): Promise<TTSResult> {
    try {
      this.stopSpeaking();

      const primaryResult = await this.ttsProvider.speak(text);
      if (primaryResult.success) {
        return primaryResult;
      }

      console.warn(
        `Primary TTS provider (${this.ttsProvider.name}) failed, falling back to the backup provider`,
        primaryResult.error,
      );

      if (!this.fallbackTTSProvider.isAvailable()) {
        return {
          success: false,
          error: `Primary TTS provider failed and backup provider unavailable: ${primaryResult.error}`,
        };
      }

      const fallbackResult = await this.fallbackTTSProvider.speak(text);
      if (fallbackResult.success) {
        console.info(
          `TTS fallback succeeded using backup provider (${this.fallbackTTSProvider.name})`,
        );
        return { success: true };
      }

      return {
        success: false,
        error: `Both primary and backup TTS failed: primary=${primaryResult.error}, backup=${fallbackResult.error}`,
      };
    } catch (error) {
      console.error('Unexpected error during TTS playback:', error);

      try {
        if (this.fallbackTTSProvider.isAvailable()) {
          const fallbackResult = await this.fallbackTTSProvider.speak(text);
          if (fallbackResult.success) {
            console.info('TTS exception fallback succeeded');
            return { success: true };
          }
        }
      } catch (fallbackError) {
        console.error('Backup TTS also threw an exception:', fallbackError);
      }

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Speech playback is temporarily unavailable',
      };
    }
  }

  /**
   * Stop the primary and backup TTS.
   */
  stopSpeaking(): void {
    try {
      this.ttsProvider.stop();
    } catch (error) {
      console.error('Error stopping primary TTS provider:', error);
    }

    try {
      this.fallbackTTSProvider.stop();
    } catch (error) {
      console.error('Error stopping backup TTS provider:', error);
    }
  }

  /**
   * Speak text with the specified accent.
   */
  async speakTextWithAccent(text: string, lang: string): Promise<TTSResult> {
    try {
      this.stopSpeaking();

      const accentMap: Record<string, 'us' | 'uk'> = {
        'en-US': 'us',
        'en-GB': 'uk',
      };
      const accent = accentMap[lang];

      if (accent && this.ttsProvider.name === 'youdao') {
        const primaryResult = await this.ttsProvider.speak(text, {
          accent,
          rate: this.config.ttsConfig.rate,
          pitch: this.config.ttsConfig.pitch,
          volume: this.config.ttsConfig.volume,
        });

        if (primaryResult.success) {
          return primaryResult;
        }

        console.warn(
          `Youdao TTS accent playback failed: ${primaryResult.error}, trying Web Speech`,
        );
      }

      const fallbackResult = await this.fallbackTTSProvider.speak(text, {
        lang,
        rate: this.config.ttsConfig.rate,
        pitch: this.config.ttsConfig.pitch,
        volume: this.config.ttsConfig.volume,
      });

      if (fallbackResult.success) {
        return fallbackResult;
      }

      console.warn(
        'All accent playback methods failed, using default pronunciation',
      );
      return await this.speakText(text);
    } catch (error) {
      console.error('Accent playback failed:', error);
      return await this.speakText(text);
    }
  }

  /**
   * Update runtime configuration.
   */
  updateConfig(config: Partial<PronunciationConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.ttsConfig) {
      if (
        config.ttsConfig.provider &&
        config.ttsConfig.provider !== this.ttsProvider.name
      ) {
        this.ttsProvider = TTSProviderFactory.createProvider(
          config.ttsConfig.provider,
          config.ttsConfig,
        );
      } else {
        this.ttsProvider.updateConfig(config.ttsConfig);
      }

      this.fallbackTTSProvider.updateConfig({
        lang: config.ttsConfig.lang,
        rate: config.ttsConfig.rate,
        pitch: config.ttsConfig.pitch,
        volume: config.ttsConfig.volume,
      });
    }

    if (config.uiConfig) {
      this.tooltipRenderer.updateConfig(config.uiConfig);
      void this.updateOriginalWordDisplayMode();
    }
  }

  /**
   * Update API configuration; changes take effect immediately for AI definitions.
   */
  async updateApiConfig(apiConfigItem?: ApiConfigItem | null): Promise<void> {
    try {
      const configToUse =
        apiConfigItem ?? (await this.storageService.getActiveApiConfigItem());
      if (configToUse) {
        this.aiTranslationProvider.updateApiConfig(configToUse);
        console.log('API configuration updated');
      } else {
        this.aiTranslationProvider.updateApiConfig(null);
        console.warn('No active API configuration found');
      }
    } catch (error) {
      console.error('Failed to update API configuration:', error);
    }
  }

  getConfig(): PronunciationConfig {
    return { ...this.config };
  }

  getTTSProviderStatus(): {
    primary: { name: string; available: boolean; speaking: boolean };
    fallback: { name: string; available: boolean; speaking: boolean };
  } {
    return {
      primary: {
        name: this.ttsProvider.name,
        available: this.ttsProvider.isAvailable(),
        speaking: this.ttsProvider.isSpeaking(),
      },
      fallback: {
        name: this.fallbackTTSProvider.name,
        available: this.fallbackTTSProvider.isAvailable(),
        speaking: this.fallbackTTSProvider.isSpeaking(),
      },
    };
  }

  destroy(): void {
    this.tooltipController.destroy();
    this.stopSpeaking();
  }

  private async updateOriginalWordDisplayMode(): Promise<void> {
    try {
      const userSettings = await this.storageService.getUserSettings();
      const mode =
        userSettings.originalWordDisplayMode || OriginalWordDisplayMode.VISIBLE;
      this.tooltipRenderer.updateOriginalWordDisplayMode(mode);
    } catch (error) {
      console.error('Failed to update original text display mode:', error);
      this.tooltipRenderer.updateOriginalWordDisplayMode(
        OriginalWordDisplayMode.VISIBLE,
      );
    }
  }
}
