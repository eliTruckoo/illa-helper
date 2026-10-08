/**
 * Storage management service
 * Manages storage of user configuration, with multi-API configuration management, event notification, and data validation
 *
 * Features:
 * - Serialized storage and retrieval of user settings
 * - Multi-API configuration management
 * - Data validation and automatic repair
 * - Event notification mechanism
 * - Configuration statistics
 */

import { browser } from 'wxt/browser';
import { UserSettings } from '../../shared/types/storage';
import {
  ApiConfig,
  ApiConfigItem,
  ApiProtocolFamily,
} from '../../shared/types/api';
import { DEFAULT_SETTINGS } from '../../shared/constants/defaults';
import {
  normalizeApiProtocolFamily,
  sanitizeApiConfig,
} from '../../shared/ApiConfigHelpers';
import {
  StorageServiceConfig,
  StorageOperationResult,
  ConfigurationStats,
  StorageEventType,
  StorageEventData,
  StorageEventListener,
} from './types';

// ==================== Storage service class ====================

/**
 * Storage management service
 * Uses the singleton pattern to provide unified storage management
 */
export class StorageService {
  private static instance: StorageService;
  private static readonly STORAGE_KEY = 'user_settings';

  // Configuration and state
  private readonly config: StorageServiceConfig;
  private readonly storageKey: string;
  private eventListeners: Map<StorageEventType, StorageEventListener[]> =
    new Map();

  /**
   * Private constructor to prevent external instantiation
   */
  private constructor(config: StorageServiceConfig = {}) {
    this.config = {
      enableAutoBackup: true,
      enableValidation: true,
      maxRetries: 3,
      storageKey: 'user_settings',
      ...config,
    };
    this.storageKey = this.config.storageKey!;
  }

  /**
   * Get the service instance
   * @param config Optional service configuration
   * @returns StorageService instance
   */
  public static getInstance(config?: StorageServiceConfig): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService(config);
    }
    return StorageService.instance;
  }

  // ==================== Event management ====================

  /**
   * Add an event listener
   * @param eventType Event type
   * @param listener Listener function
   */
  public addEventListener(
    eventType: StorageEventType,
    listener: StorageEventListener,
  ): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType)!.push(listener);
  }

  /**
   * Remove an event listener
   * @param eventType Event type
   * @param listener Listener function
   */
  public removeEventListener(
    eventType: StorageEventType,
    listener: StorageEventListener,
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event
   * @param eventType Event type
   * @param data Event data
   * @param error Error message
   */
  private emitEvent(
    eventType: StorageEventType,
    data?: any,
    error?: string,
  ): void {
    const event: StorageEventData = {
      type: eventType,
      timestamp: Date.now(),
      data,
      error,
    };

    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (e) {
          console.error('Storage event listener error:', e);
        }
      });
    }
  }

  // ==================== Core storage functions ====================

  /**
   * Get user settings
   * @returns User settings
   */
  public async getUserSettings(): Promise<UserSettings> {
    try {
      const result = await browser.storage.sync.get(StorageService.STORAGE_KEY);
      const serializedData = result[StorageService.STORAGE_KEY];

      if (!serializedData) {
        this.emitEvent(StorageEventType.SETTINGS_LOADED, DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }

      const userSettings: UserSettings = JSON.parse(serializedData);
      const validatedSettings = this.validateAndFixSettings(userSettings);

      if (this.hasConfigurationChanged(userSettings, validatedSettings)) {
        await this.saveUserSettings(validatedSettings);
      }

      this.emitEvent(StorageEventType.SETTINGS_LOADED, validatedSettings);
      return validatedSettings;
    } catch (error) {
      const errorMessage = `Failed to get user settings: ${error}`;
      console.error(errorMessage);
      this.emitEvent(
        StorageEventType.SETTINGS_LOADED,
        DEFAULT_SETTINGS,
        errorMessage,
      );
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save user settings
   * @param settings User settings to save
   */
  public async saveUserSettings(
    settings: UserSettings,
  ): Promise<StorageOperationResult> {
    try {
      // Validate settings
      if (this.config.enableValidation) {
        settings = this.validateAndFixSettings(settings);
      }

      // Serialize data
      const serializedData = JSON.stringify(settings);

      await browser.storage.sync.set({
        [this.storageKey]: serializedData,
      });

      this.emitEvent(StorageEventType.SETTINGS_SAVED, settings);
      return { success: true, data: settings };
    } catch (error) {
      const errorMessage = `Failed to save user settings: ${error}`;
      console.error(errorMessage);
      this.emitEvent(StorageEventType.SETTINGS_SAVED, null, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  // ==================== API configuration management ====================

  /**
   * Get the active API configuration item, keeping the id and protocol family so the call chain does not lose the configuration identity.
   */
  public async getActiveApiConfigItem(): Promise<ApiConfigItem | null> {
    try {
      const settings = await this.getUserSettings();
      return (
        settings.apiConfigs.find(
          (config) => config.id === settings.activeApiConfigId,
        ) || null
      );
    } catch (error) {
      console.error('Failed to get active API config item:', error);
      return null;
    }
  }

  /**
   * Get the active API configuration
   */
  public async getActiveApiConfig(): Promise<ApiConfig | null> {
    try {
      const activeConfig = await this.getActiveApiConfigItem();
      return activeConfig?.config || null;
    } catch (error) {
      console.error('Failed to get active API config:', error);
      return null;
    }
  }

  /**
   * Set the active API configuration
   */
  public async setActiveApiConfig(
    configId: string,
  ): Promise<StorageOperationResult> {
    try {
      const settings = await this.getUserSettings();
      const configExists = settings.apiConfigs.some(
        (config) => config.id === configId,
      );

      if (!configExists) {
        const errorMessage = `API config ${configId} does not exist`;
        console.error(errorMessage);
        return { success: false, error: errorMessage };
      }

      settings.activeApiConfigId = configId;
      const saveResult = await this.saveUserSettings(settings);

      if (saveResult.success) {
        this.emitEvent(StorageEventType.ACTIVE_CONFIG_CHANGED, { configId });
      }

      return saveResult;
    } catch (error) {
      const errorMessage = `Failed to set active API config: ${error}`;
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Add a new API configuration
   */
  public async addApiConfig(
    name: string,
    protocolFamily: ApiProtocolFamily,
    config: ApiConfig,
  ): Promise<StorageOperationResult> {
    try {
      const settings = await this.getUserSettings();
      const newConfig: ApiConfigItem = {
        id: `config-${Date.now()}`,
        name,
        protocolFamily,
        config: sanitizeApiConfig(config),
      };

      settings.apiConfigs.push(newConfig);
      const saveResult = await this.saveUserSettings(settings);

      if (saveResult.success) {
        this.emitEvent(StorageEventType.API_CONFIG_ADDED, newConfig);
        return { success: true, data: newConfig.id };
      }

      return saveResult;
    } catch (error) {
      const errorMessage = `Failed to add API config: ${error}`;
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update an API configuration
   */
  public async updateApiConfig(
    configId: string,
    name: string,
    protocolFamily: ApiProtocolFamily,
    config: ApiConfig,
  ): Promise<StorageOperationResult> {
    try {
      const settings = await this.getUserSettings();
      const configIndex = settings.apiConfigs.findIndex(
        (c) => c.id === configId,
      );

      if (configIndex === -1) {
        const errorMessage = `API config ${configId} does not exist`;
        console.error(errorMessage);
        return { success: false, error: errorMessage };
      }

      const updatedConfig = {
        ...settings.apiConfigs[configIndex],
        name,
        protocolFamily,
        config: sanitizeApiConfig(config),
      };

      settings.apiConfigs[configIndex] = updatedConfig;

      const saveResult = await this.saveUserSettings(settings);

      if (saveResult.success) {
        this.emitEvent(StorageEventType.API_CONFIG_UPDATED, updatedConfig);
      }

      return saveResult;
    } catch (error) {
      const errorMessage = `Failed to update API config: ${error}`;
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Delete an API configuration
   */
  public async removeApiConfig(
    configId: string,
  ): Promise<StorageOperationResult> {
    try {
      const settings = await this.getUserSettings();

      if (settings.apiConfigs.length <= 1) {
        const errorMessage = 'At least one API config must remain';
        console.error(errorMessage);
        return { success: false, error: errorMessage };
      }

      // If the deleted config is the active one, switch to the first config
      if (settings.activeApiConfigId === configId) {
        const firstConfig = settings.apiConfigs.find((c) => c.id !== configId);
        if (firstConfig) {
          settings.activeApiConfigId = firstConfig.id;
        }
      }

      settings.apiConfigs = settings.apiConfigs.filter(
        (c) => c.id !== configId,
      );

      const saveResult = await this.saveUserSettings(settings);

      if (saveResult.success) {
        this.emitEvent(StorageEventType.API_CONFIG_REMOVED, { configId });
      }

      return saveResult;
    } catch (error) {
      const errorMessage = `Failed to delete API config: ${error}`;
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  // ==================== Data management ====================

  /**
   * Clear all data
   */
  public async clearAllData(): Promise<StorageOperationResult> {
    try {
      await browser.storage.sync.remove(this.storageKey);
      this.emitEvent(StorageEventType.DATA_CLEARED);
      return { success: true };
    } catch (error) {
      const errorMessage = `Failed to clear data: ${error}`;
      console.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get configuration statistics - simplified version
   */
  public async getConfigStats(): Promise<ConfigurationStats> {
    try {
      const settings = await this.getUserSettings();

      return {
        intelligentModeEnabled: true, // enabled by default after simplification
        targetLanguage: settings.multilingualConfig.targetLanguage,
        totalKeys: Object.keys(settings).length,
        apiConfigsCount: settings.apiConfigs.length,
      };
    } catch (error) {
      console.error('Failed to get config statistics:', error);
      return {
        intelligentModeEnabled: true,
        targetLanguage: 'en',
        totalKeys: 0,
        apiConfigsCount: 0,
      };
    }
  }

  // ==================== Data validation ====================

  /**
   * Validate and repair settings
   * @param settings Original settings
   * @returns Repaired settings
   */
  private validateAndFixSettings(settings: UserSettings): UserSettings {
    const validatedSettings = { ...settings };

    try {
      // Ensure required fields exist
      if (!validatedSettings.apiConfigs) {
        validatedSettings.apiConfigs = DEFAULT_SETTINGS.apiConfigs;
      }

      validatedSettings.apiConfigs = this.normalizeApiConfigs(
        validatedSettings.apiConfigs,
      );

      if (validatedSettings.apiConfigs.length === 0) {
        validatedSettings.apiConfigs = DEFAULT_SETTINGS.apiConfigs;
      }

      if (!validatedSettings.activeApiConfigId) {
        if (validatedSettings.apiConfigs.length > 0) {
          validatedSettings.activeApiConfigId =
            validatedSettings.apiConfigs[0].id;
        }
      }

      // Verify that the active config exists
      if (validatedSettings.activeApiConfigId) {
        const activeConfigExists = validatedSettings.apiConfigs.some(
          (config) => config.id === validatedSettings.activeApiConfigId,
        );

        if (!activeConfigExists && validatedSettings.apiConfigs.length > 0) {
          validatedSettings.activeApiConfigId =
            validatedSettings.apiConfigs[0].id;
        }
      }

      // Verify other required fields
      if (!validatedSettings.multilingualConfig) {
        validatedSettings.multilingualConfig =
          DEFAULT_SETTINGS.multilingualConfig;
      }

      // Ensure the lazy loading config exists
      if (!validatedSettings.lazyLoading) {
        validatedSettings.lazyLoading = DEFAULT_SETTINGS.lazyLoading;
      }

      return validatedSettings;
    } catch (error) {
      console.error(`Settings validation error: ${error}`);
      return DEFAULT_SETTINGS;
    }
  }

  private normalizeApiConfigs(rawConfigs: unknown[]): ApiConfigItem[] {
    return rawConfigs
      .map((rawConfig, index) => this.normalizeApiConfigItem(rawConfig, index))
      .filter((config): config is ApiConfigItem => config !== null);
  }

  private normalizeApiConfigItem(
    rawConfig: unknown,
    index: number,
  ): ApiConfigItem | null {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    const candidate = rawConfig as Partial<ApiConfigItem> & {
      protocolFamily?: string;
      config?: Partial<ApiConfig>;
    };

    const protocolFamily = normalizeApiProtocolFamily(candidate.protocolFamily);
    if (!protocolFamily) {
      // Only the current protocol family is accepted; legacy provider names and unknown configs are dropped.
      return null;
    }

    return {
      id: candidate.id?.trim() || `config-${Date.now()}-${index}`,
      name: candidate.name?.trim() || this.getDefaultConfigName(protocolFamily),
      protocolFamily,
      config: sanitizeApiConfig(candidate.config),
    };
  }

  private getDefaultConfigName(protocolFamily: ApiProtocolFamily): string {
    return protocolFamily === ApiProtocolFamily.GEMINI
      ? 'Gemini'
      : 'OpenAI Compatible';
  }

  /**
   * Check whether the configuration changed
   * @param original Original configuration
   * @param fixed Repaired configuration
   * @returns Whether it changed
   */
  private hasConfigurationChanged(
    original: UserSettings,
    fixed: UserSettings,
  ): boolean {
    try {
      return JSON.stringify(original) !== JSON.stringify(fixed);
    } catch {
      return true; // If the comparison fails, assume it changed
    }
  }
}

// ==================== Exports ====================

// Singleton instance export
export const storageService = StorageService.getInstance();

// Default export
export default StorageService;
