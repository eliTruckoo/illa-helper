/**
 * Default configuration constants
 * Contains all default settings and configuration used in the project
 */

import type {
  ApiConfig,
  ApiConfigItem,
  ApiProtocolFamily,
  MultilingualConfig,
} from '../types/api';
import type { FloatingBallConfig, TooltipHotkey } from '../types/ui';
import type { TranslationCacheConfig, UserSettings } from '../types/storage';
import type { LazyLoadingConfig } from '../types/core';
import { createEmptyApiConfig } from '../ApiConfigHelpers';
import {
  UserLevel,
  TranslationStyle,
  TriggerMode,
  OriginalWordDisplayMode,
  TranslationPosition,
  TranslationMode,
} from '../types/core';

// Default API configuration
export const DEFAULT_API_CONFIG: ApiConfig = {
  ...createEmptyApiConfig(),
  apiKey: import.meta.env.VITE_WXT_DEFAULT_API_KEY || '',
  apiEndpoint:
    import.meta.env.VITE_WXT_DEFAULT_API_ENDPOINT ||
    'https://api.openai.com/v1/chat/completions',
  model: import.meta.env.VITE_WXT_DEFAULT_MODEL || 'gpt-4o-mini',
  temperature: parseFloat(import.meta.env.VITE_WXT_DEFAULT_TEMPERATURE) || 0,
};

// Default language configuration - minimal version
export const DEFAULT_MULTILINGUAL_CONFIG: MultilingualConfig = {
  nativeLanguage: 'zh', // Chinese as the default native language
  targetLanguage: 'en', // English as the default target language
};

// Default pronunciation shortcut configuration
export const DEFAULT_PRONUNCIATION_HOTKEY: TooltipHotkey = {
  enabled: true,
  modifierKeys: [],
  description: 'Shortcut',
};

// Default floating ball configuration
export const DEFAULT_FLOATING_BALL_CONFIG: FloatingBallConfig = {
  enabled: true,
  position: 50, // Middle position
  opacity: 0.8, // 80% opacity
};

// Default lazy loading configuration - simplified version
export const DEFAULT_LAZY_LOADING_CONFIG: LazyLoadingConfig = {
  enabled: true, //  Lazy loading toggle
  preloadDistance: 0.5, // Fixed preload of half a screen ahead
};

// Default persistent translation memory configuration
export const DEFAULT_TRANSLATION_CACHE_CONFIG: TranslationCacheConfig = {
  enabled: true,
  maxEntries: 20000,
  ttlDays: 30,
};

// Function to create a default API configuration item
function createDefaultApiConfigItem(): ApiConfigItem {
  return {
    id: 'default-config',
    name: 'OpenAI',
    protocolFamily: 'openai-compatible' as ApiProtocolFamily,
    config: DEFAULT_API_CONFIG,
  };
}

// Default user settings
export const DEFAULT_SETTINGS: UserSettings = {
  userLevel: UserLevel.B1,
  replacementRate: 0.3,
  isEnabled: true,
  useGptApi: true,
  apiConfigs: [createDefaultApiConfigItem()],
  activeApiConfigId: 'default-config',
  translationStyle: TranslationStyle.DEFAULT,
  translationMode: TranslationMode.WORD,
  triggerMode: TriggerMode.MANUAL,
  maxLength: 400,
  originalWordDisplayMode: OriginalWordDisplayMode.VISIBLE,
  enablePronunciationTooltip: true,
  multilingualConfig: DEFAULT_MULTILINGUAL_CONFIG,
  pronunciationHotkey: DEFAULT_PRONUNCIATION_HOTKEY,
  floatingBall: DEFAULT_FLOATING_BALL_CONFIG,
  translationPosition: TranslationPosition.AFTER,
  showParentheses: true,
  apiRequestTimeout: 30000, // 30 s per attempt; 0 = unlimited (capped by the background proxy)
  apiTimeoutMigrated: true,
  customTranslationCSS: '',
  lazyLoading: DEFAULT_LAZY_LOADING_CONFIG,
  translationCache: DEFAULT_TRANSLATION_CACHE_CONFIG,
};
