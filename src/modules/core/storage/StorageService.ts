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

  // Configuration and state
  private readonly config: StorageServiceConfig;
  private readonly storageKey: string;
  private eventListeners: Map<StorageEventType, StorageEventListener[]> =
    new Map();

  // In-memory settings cache (one per JS context). Kept fresh by a single
  // storage.onChanged listener and by saveUserSettings; never handed out
  // directly, callers always receive a copy.
  private cachedSettings: UserSettings | null = null;
  private pendingSettingsLoad: Promise<UserSettings> | null = null;
  // Bumped on every cache write/invalidation so a slow storage read that
  // started earlier cannot overwrite newer data.
  private cacheGeneration = 0;
  private storageListenerAttached = false;

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
   * Served from the in-memory cache after the first read; the returned object
   * is always a private copy that callers may mutate freely.
   * @returns User settings
   */
  public async getUserSettings(): Promise<UserSettings> {
    this.ensureStorageChangeListener();

    if (this.cachedSettings) {
      return cloneSettings(this.cachedSettings);
    }

    // Coalesce concurrent first reads into one storage round-trip
    let load = this.pendingSettingsLoad;
    if (!load) {
      const newLoad = this.loadUserSettingsFromStorage();
      load = newLoad;
      this.pendingSettingsLoad = newLoad;
      void newLoad.finally(() => {
        if (this.pendingSettingsLoad === newLoad) {
          this.pendingSettingsLoad = null;
        }
      });
    }

    return cloneSettings(await load);
  }

  /**
   * Drop the in-memory settings cache so the next read hits storage.
   */
  public invalidateSettingsCache(): void {
    this.cachedSettings = null;
    this.pendingSettingsLoad = null;
    this.cacheGeneration++;
  }

  /**
   * Read, validate and cache settings from storage.
   * This is the only read path that may write: a one-time normalisation
   * (migration) of stored data that fails validation.
   */
  private async loadUserSettingsFromStorage(): Promise<UserSettings> {
    const generation = this.cacheGeneration;
    try {
      const result = await browser.storage.sync.get(this.storageKey);
      const serializedData = result[this.storageKey];

      if (!serializedData) {
        const defaults = cloneSettings(DEFAULT_SETTINGS);
        this.setCachedSettings(defaults, generation);
        this.emitEvent(StorageEventType.SETTINGS_LOADED, defaults);
        return defaults;
      }

      const userSettings: UserSettings = JSON.parse(serializedData);
      const validatedSettings = this.validateAndFixSettings(userSettings);

      if (this.hasConfigurationChanged(userSettings, validatedSettings)) {
        await this.saveUserSettings(validatedSettings);
      }

      const settings = cloneSettings(validatedSettings);
      this.setCachedSettings(settings, generation);
      this.emitEvent(StorageEventType.SETTINGS_LOADED, settings);
      return settings;
    } catch (error) {
      const errorMessage = `Failed to get user settings: ${error}`;
      console.error(errorMessage);
      // Errors are not cached: the next call retries the storage read.
      const defaults = cloneSettings(DEFAULT_SETTINGS);
      this.emitEvent(StorageEventType.SETTINGS_LOADED, defaults, errorMessage);
      return defaults;
    }
  }

  /**
   * Store settings in the cache unless a newer write/invalidation happened
   * since the read identified by `generation` started.
   */
  private setCachedSettings(settings: UserSettings, generation: number): void {
    if (generation !== this.cacheGeneration) {
      return;
    }
    this.cachedSettings = settings;
  }

  /**
   * Replace the cache with settings that are known to be current and notify
   * SETTINGS_CHANGED subscribers.
   */
  private updateCachedSettings(settings: UserSettings | null): void {
    this.cacheGeneration++;
    this.pendingSettingsLoad = null;
    this.cachedSettings = settings;
    this.emitEvent(
      StorageEventType.SETTINGS_CHANGED,
      settings ? cloneSettings(settings) : null,
    );
  }

  /**
   * Register the single storage.onChanged listener for this JS context.
   * Writes from any context (options page, popup, background) refresh the cache.
   */
  private ensureStorageChangeListener(): void {
    if (this.storageListenerAttached) return;
    this.storageListenerAttached = true;

    const onChanged = browser?.storage?.onChanged;
    if (!onChanged?.addListener) return;

    onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      const change = changes[this.storageKey];
      if (!change) return;

      if (typeof change.newValue !== 'string') {
        // Key removed (or unexpected shape): fall back to a fresh read later.
        this.updateCachedSettings(null);
        return;
      }

      try {
        const parsed: UserSettings = JSON.parse(change.newValue);
        this.updateCachedSettings(this.validateAndFixSettings(parsed));
      } catch (error) {
        console.error('Failed to apply changed user settings:', error);
        this.updateCachedSettings(null);
      }
    });
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

      // Read-your-writes in this context without waiting for onChanged
      this.ensureStorageChangeListener();
      this.updateCachedSettings(JSON.parse(serializedData));

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
      this.updateCachedSettings(null);
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
        targetLanguage: DEFAULT_SETTINGS.multilingualConfig.targetLanguage,
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

      // Ensure the translation memory config exists (older installs lack it)
      if (!validatedSettings.translationCache) {
        validatedSettings.translationCache = {
          ...DEFAULT_SETTINGS.translationCache,
        };
      }

      // One-time migration: 0 ("no timeout") used to be the default, so a
      // stored 0 from before is moved to the 30 s default. An explicit 0 set
      // after the migration is kept.
      if (!validatedSettings.apiTimeoutMigrated) {
        if (!validatedSettings.apiRequestTimeout) {
          validatedSettings.apiRequestTimeout =
            DEFAULT_SETTINGS.apiRequestTimeout;
        }
        validatedSettings.apiTimeoutMigrated = true;
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

// ==================== Helpers ====================

/**
 * Deep-copy settings so callers can never mutate the cache or DEFAULT_SETTINGS.
 * Settings are plain JSON data; the JSON fallback covers contexts without
 * structuredClone and values structuredClone refuses (e.g. Vue proxies).
 */
export function cloneSettings(settings: UserSettings): UserSettings {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(settings);
    } catch {
      // fall through to JSON copy
    }
  }
  return JSON.parse(JSON.stringify(settings));
}

// ==================== Exports ====================

// Singleton instance export
export const storageService = StorageService.getInstance();

// Default export
export default StorageService;
