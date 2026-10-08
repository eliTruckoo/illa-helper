/**
 * Unified entry point for the storage service
 * Exports all storage management functionality
 */

// Service class exports
export { default as StorageService, storageService } from './StorageService';

// Type definition exports
export type {
  StorageOperationResult,
  ConfigurationStats,
  ValidationResult,
  StorageServiceConfig,
  StorageEventData,
  StorageEventListener,
  UserSettings,
  ApiConfig,
  ApiConfigItem,
} from './types';

export { StorageEventType } from './types';

// Default export
export { storageService as default } from './StorageService';
