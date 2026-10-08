/**
 * Storage service type definitions
 * Includes types for storage management, config statistics, data validation, etc.
 */

import { UserSettings } from '../../shared/types/storage';
import { ApiConfig, ApiConfigItem } from '../../shared/types/api';

// ==================== Storage operation types ====================

/**
 * Storage operation result
 */
export interface StorageOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * Configuration statistics
 */
export interface ConfigurationStats {
  intelligentModeEnabled: boolean;
  targetLanguage: string;
  totalKeys: number;
  apiConfigsCount: number;
}

/**
 * Storage service configuration
 */
export interface StorageServiceConfig {
  enableAutoBackup?: boolean;
  enableValidation?: boolean;
  maxRetries?: number;
  storageKey?: string;
}

/**
 * Data validation result
 */
export interface ValidationResult {
  isValid: boolean;
  hasChanges: boolean;
  validatedData: UserSettings;
  errors: string[];
}

/**
 * Storage event types
 */
export enum StorageEventType {
  SETTINGS_LOADED = 'settings_loaded',
  SETTINGS_SAVED = 'settings_saved',
  /** Cached settings changed (local save or a write from another context); data is the new settings or null when cleared */
  SETTINGS_CHANGED = 'settings_changed',
  API_CONFIG_ADDED = 'api_config_added',
  API_CONFIG_UPDATED = 'api_config_updated',
  API_CONFIG_REMOVED = 'api_config_removed',
  ACTIVE_CONFIG_CHANGED = 'active_config_changed',
  DATA_CLEARED = 'data_cleared',
}

/**
 * Storage event data
 */
export interface StorageEventData {
  type: StorageEventType;
  timestamp: number;
  data?: any;
  error?: string;
}

/**
 * Storage service event listener
 */
export type StorageEventListener = (event: StorageEventData) => void;

// ==================== Export summary ====================

export type { UserSettings, ApiConfig, ApiConfigItem };
