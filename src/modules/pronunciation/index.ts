/**
 * Pronunciation module main entry
 * Provides a unified API
 */

// Core services
export { PronunciationService } from './services/PronunciationService';

// Configuration
export * from './config';

// Type definitions
export * from './types';

// Providers (exported by feature module)
export * from './phonetic';
export * from './tts';
export * from './translation';

// Utilities
export * from './utils';

// UI components
export * from './ui';

// Default export of the main service
export { PronunciationService as default } from './services/PronunciationService';
