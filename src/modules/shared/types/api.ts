/**
 * API-related type definitions
 * Contains API configuration, translation request/response, and related interfaces
 */

export enum ApiProtocolFamily {
  OPENAI_COMPATIBLE = 'openai-compatible',
  GEMINI = 'gemini',
}

// Translation replacement result interface
export interface Replacement {
  original: string;
  translation: string;
  position: {
    start: number;
    end: number;
  };
  isNew: boolean;
  explanation?: string;
  // Pronunciation-related fields
  hasPhonetic?: boolean;
  phoneticData?: any; // concrete type will be defined in the pronunciation module
  // New: language detection info
  detectedSourceLanguage?: string;
  targetLanguage?: string;
}

/**
 * Outcome of a translation request.
 * - ok: valid response with at least one replacement
 * - empty: valid response without replacements (cacheable success)
 * - error: the request or response failed (must never be cached)
 */
export type TranslationResultStatus = 'ok' | 'empty' | 'error';

// Full-text analysis response interface
export interface FullTextAnalysisResponse {
  original: string;
  processed: string;
  replacements: Replacement[];
  /** Missing status is treated as 'ok'/'empty' depending on replacements */
  status?: TranslationResultStatus;
  /** Error message when status is 'error' */
  error?: string;
}

/**
 * Answer to a batch request carrying several segments.
 */
export interface BatchAnalysisResponse {
  /** 'error' when the whole request failed */
  status: 'ok' | 'error';
  error?: string;
  /** One entry per input text, in input order; undefined = the model did not answer this item */
  items: Array<FullTextAnalysisResponse | undefined>;
}

// API configuration interface
export interface ApiConfig {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  temperature: number;
  enable_thinking?: boolean;
  includeThinkingParam?: boolean;
  customParams?: string;
  phraseEnabled?: boolean;
  requestsPerSecond?: number; // Maximum requests per second
}

// API configuration item interface, including configuration metadata
export interface ApiConfigItem {
  id: string;
  name: string;
  protocolFamily: ApiProtocolFamily;
  config: ApiConfig;
}

// Replacement configuration interface
export interface ReplacementConfig {
  userLevel: import('./core').UserLevel;
  replacementRate: number;
  useGptApi: boolean;
  userSettings: import('./storage').UserSettings;
  activeApiConfig: ApiConfigItem | null;
  apiConfig: ApiConfig;
  inlineTranslation: boolean;
  translationStyle: import('./core').TranslationStyle;
}

// Multi-language translation configuration interface - minimal version
export interface MultilingualConfig {
  nativeLanguage: string; // Native language (fixed user setting)
  targetLanguage: string; // Target language (user's learning goal)
}

// Language option interface
export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  isPopular?: boolean;
}
