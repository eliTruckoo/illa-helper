/**
 * Storage configuration type definitions
 * Includes interfaces for user settings, context menu, messaging, etc.
 */

import type {
  UserLevel,
  TranslationStyle,
  TriggerMode,
  OriginalWordDisplayMode,
  TranslationPosition,
  TranslationMode,
  ContextMenuActionType,
  UrlPatternType,
  LazyLoadingConfig,
} from './core';
import type { ApiConfigItem, MultilingualConfig } from './api';
import type { TooltipHotkey, FloatingBallConfig } from './ui';

// Main user settings interface
export interface UserSettings {
  userLevel: UserLevel;
  replacementRate: number;
  isEnabled: boolean;
  useGptApi: boolean;
  // Changed: supports multiple API configurations
  apiConfigs: ApiConfigItem[];
  activeApiConfigId: string;
  translationStyle: TranslationStyle;
  translationMode: TranslationMode;
  triggerMode: TriggerMode;
  maxLength?: number;
  originalWordDisplayMode: OriginalWordDisplayMode;
  enablePronunciationTooltip: boolean;
  // Added: multilingual smart translation settings
  multilingualConfig: MultilingualConfig;
  // Added: pronunciation popup shortcut settings
  pronunciationHotkey: TooltipHotkey;
  // Added: floating ball settings
  floatingBall: FloatingBallConfig;
  // Added: translation position settings
  translationPosition: TranslationPosition;
  // Added: whether to show brackets
  showParentheses: boolean;
  // Added: API request timeout configuration
  apiRequestTimeout: number; // in milliseconds
  // One-time migration marker: stored 0 (old default) was moved to the 30 s default
  apiTimeoutMigrated?: boolean;
  // Added: custom translation style CSS
  customTranslationCSS: string;
  // Added: lazy loading configuration
  lazyLoading: LazyLoadingConfig;
  // Persistent cross-tab translation memory (background IndexedDB)
  translationCache: TranslationCacheConfig;
  // Page glossary (opt-in): reuse word translations already shown on the page
  pageGlossary?: PageGlossaryConfig;
}

// Persistent translation memory settings
export interface TranslationCacheConfig {
  /** Disabled = no lookups and no stores */
  enabled: boolean;
  /** Entry cap; the least recently used entries are evicted above it */
  maxEntries: number;
  /** Lifetime of successful answers in days (empty answers: at most 3 days) */
  ttlDays: number;
}

/**
 * Page glossary settings (word mode)
 */
export interface PageGlossaryConfig {
  /** Reuse translations already shown on the page for the same word form */
  enabled: boolean;
  /** Tell the model which glossary words a segment already has (fewer output tokens) */
  promptHint: boolean;
  /** Skip the request for a segment the glossary alone fills (never two segments in a row) */
  economyMode: boolean;
}

// Context menu message interface
export interface ContextMenuMessage {
  type: ContextMenuActionType;
  url: string;
  pattern: string;
  patternType: UrlPatternType;
  description?: string;
}
