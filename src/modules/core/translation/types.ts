/**
 * Core type definitions for the translation services
 * Includes types for text replacement, processing, prompt management and language management
 */

import {
  ReplacementConfig,
  FullTextAnalysisResponse,
  ApiConfig,
  LanguageOption,
  MultilingualConfig,
} from '../../shared/types/api';
import { UserSettings } from '../../shared/types/storage';
import {
  UserLevel,
  OriginalWordDisplayMode,
  TranslationPosition,
  TranslationStyle,
} from '../../shared/types/core';

// ==================== Text replacer service types ====================

/**
 * Replacement result interface
 */
export interface ReplacementResult {
  original: string; // Original text
  replaced: string; // Replaced text
  replacedWords: Array<{
    chinese: string;
    english: string;
    position: {
      start: number;
      end: number;
    };
    isNew: boolean; // Whether it is a new word
  }>;
}

/**
 * Cache key interface - simplified
 */
export interface CacheKey {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  userLevel: number;
  replacementRate: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  cacheSize: number;
}

// ==================== Text processor service types ====================

/**
 * Content segmentation configuration
 */
export interface SegmentConfig {
  maxSegmentLength: number;
  minSegmentLength: number;
  mergeSmallSegments: boolean;
}

/**
 * Processing statistics
 */
export interface ProcessingStats {
  coordinator: any; // Coordinator statistics
  global: any; // Global statistics
}

// ==================== Prompt service types ====================

/**
 * Prompt configuration interface - simplified
 */
export interface PromptConfig {
  targetLanguage: string;
  userLevel: UserLevel;
  replacementRate: number;
}

/**
 * Prompt generation options
 */
export interface PromptOptions {
  isTraditional?: boolean;
  includeExamples?: boolean;
  customInstructions?: string;
}

// ==================== Language service types ====================

/**
 * Language info interface
 */
export interface Language {
  code: string; // e.g., 'en', 'zh', 'ja'
  name: string; // e.g., 'English', 'Chinese', 'Japanese'
  nativeName: string; // e.g., 'English', 'Chinese', 'Japanese'
  isPopular?: boolean; // Marks commonly used languages
}

// ==================== Service base class types ====================

/**
 * Service base class configuration
 */
export interface ServiceConfig {
  enableLogging?: boolean;
  cacheEnabled?: boolean;
  maxRetries?: number;
}

/**
 * Service initialization options
 */
export interface ServiceInitOptions {
  apiConfig?: ApiConfig;
  userSettings?: UserSettings;
  customConfig?: Record<string, any>;
}

// ==================== Translation flow types ====================

/**
 * Translation processing context
 */
export interface TranslationContext {
  text: string;
  settings: UserSettings;
  config: ReplacementConfig;
  originalWordDisplayMode: OriginalWordDisplayMode;
  translationPosition: TranslationPosition;
  showParentheses: boolean;
  maxLength?: number;
}

/**
 * Translation processing result
 */
export interface TranslationProcessResult {
  success: boolean;
  result?: FullTextAnalysisResponse;
  error?: string;
  fromCache?: boolean;
}

// ==================== Export summary ====================

export type {
  UserSettings,
  ReplacementConfig,
  FullTextAnalysisResponse,
  ApiConfig,
  LanguageOption,
  MultilingualConfig,
  UserLevel,
  OriginalWordDisplayMode,
  TranslationPosition,
  TranslationStyle,
};
