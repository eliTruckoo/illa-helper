import {
  UserSettings,
  ReplacementConfig,
  TranslationStyle,
} from '@/src/modules/shared/types';
import { StorageService } from '@/src/modules/core/storage';
import { StyleManager } from '@/src/modules/styles';
import { TextReplacerService } from '@/src/modules/core/translation/TextReplacerService';
import { languageService } from '@/src/modules/core/translation/LanguageService';
import { IConfigurationService } from '../types';

/**
 * Configuration service - handles user settings and API configuration
 */
export class ConfigurationService implements IConfigurationService {
  private storageService: StorageService;

  constructor() {
    this.storageService = StorageService.getInstance();
  }

  /**
   * Get user settings
   */
  async getUserSettings(): Promise<UserSettings> {
    return await this.storageService.getUserSettings();
  }

  /**
   * Create the replacement configuration object
   */
  createReplacementConfig(
    settings: UserSettings,
    pageLanguage?: string,
  ): ReplacementConfig {
    const effectiveSettings = this.resolveSettingsForPage(
      settings,
      pageLanguage,
    );

    // Get the currently active API configuration
    const activeConfig = effectiveSettings.apiConfigs.find(
      (config) => config.id === effectiveSettings.activeApiConfigId,
    );

    return {
      userLevel: effectiveSettings.userLevel,
      replacementRate: effectiveSettings.replacementRate,
      useGptApi: effectiveSettings.useGptApi,
      userSettings: effectiveSettings,
      activeApiConfig: activeConfig || null,
      apiConfig: activeConfig?.config || {
        apiKey: '',
        apiEndpoint: '',
        model: '',
        temperature: 0,
        enable_thinking: false,
        phraseEnabled: true,
      },
      inlineTranslation: true,
      translationStyle: effectiveSettings.translationStyle,
    };
  }

  /**
   * Update the configuration of all related modules from the latest settings
   */
  updateConfiguration(
    settings: UserSettings,
    styleManager: StyleManager,
    textReplacer: TextReplacerService,
    pageLanguage?: string,
  ): void {
    styleManager.setTranslationStyle(settings.translationStyle);

    // If using a custom style, apply the custom CSS
    if (settings.translationStyle === TranslationStyle.CUSTOM) {
      styleManager.setCustomCSS(settings.customTranslationCSS);
    }

    textReplacer.updateConfig(
      this.createReplacementConfig(settings, pageLanguage),
    );
  }

  /**
   * Get the active API configuration
   */
  getActiveApiConfig(settings: UserSettings) {
    return settings.apiConfigs.find(
      (config) => config.id === settings.activeApiConfigId,
    );
  }

  /**
   * Whether the active API configuration is usable (has an API key).
   * Mirrors the background 'validate-configuration' check, without the
   * round trip to the service worker.
   */
  hasValidApiConfig(settings: UserSettings): boolean {
    return !!this.getActiveApiConfig(settings)?.config?.apiKey;
  }

  private resolveSettingsForPage(
    settings: UserSettings,
    pageLanguage?: string,
  ): UserSettings {
    if (!pageLanguage) {
      return settings;
    }

    return {
      ...settings,
      multilingualConfig: {
        ...settings.multilingualConfig,
        targetLanguage: languageService.resolveTargetLanguage(
          settings.multilingualConfig,
          pageLanguage,
        ),
      },
    };
  }
}
