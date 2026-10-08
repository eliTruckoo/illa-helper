/**
 * Phonetic type definitions
 */

/**
 * Phonetic information interface
 * Contains complete information for a word, including phonetics, meanings and AI translation
 */
export interface PhoneticInfo {
  /** Word text */
  word: string;
  /** Array of phonetic entries */
  phonetics: PhoneticEntry[];
  /** Array of meaning entries (optional) */
  meanings?: MeaningEntry[];
  /** AI translation definition (optional) */
  aiTranslation?: AITranslationEntry;
  /** Error state information (optional) */
  error?: {
    /** Whether there was a phonetic fetch error */
    hasPhoneticError: boolean;
    /** Phonetic error message */
    phoneticErrorMessage?: string;
  };
}

/**
 * Phonetic entry interface
 * Contains the phonetic text, audio and source information
 */
export interface PhoneticEntry {
  /** Phonetic text (e.g.: /ˈhɛloʊ/) */
  text?: string;
  /** Audio file URL */
  audio?: string;
  /** Data source URL */
  sourceUrl?: string;
}

/**
 * Meaning entry interface
 * Contains part of speech and definition information
 */
export interface MeaningEntry {
  /** Part of speech */
  partOfSpeech: string;
  /** Array of definition entries */
  definitions: DefinitionEntry[];
}

/**
 * Definition entry interface
 * Contains the concrete definition, example sentence and synonyms
 */
export interface DefinitionEntry {
  /** Definition */
  definition: string;
  /** Example sentence (optional) */
  example?: string;
  /** Array of synonyms (optional) */
  synonyms?: string[];
}

/**
 * Phonetic fetch result interface
 * Contains the complete result of a phonetic lookup
 */
export interface PhoneticResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Phonetic data (returned on success) */
  data?: PhoneticInfo;
  /** Error message (returned on failure) */
  error?: string;
  /** Whether the result came from cache */
  cached?: boolean;
}

/**
 * Cache entry interface
 * Used to implement an in-memory cache with TTL
 */
export interface CacheEntry<T> {
  /** Cached data */
  data: T;
  /** Cache creation timestamp */
  timestamp: number;
  /** Time to live (milliseconds) */
  ttl: number;
}

/**
 * AI translation entry interface
 * Contains the AI-translated meaning explanation and source information
 */
export interface AITranslationEntry {
  /** Meaning explanation text */
  explain: string;
  /** Translation source identifier */
  source: string;
}

/**
 * AI translation result interface
 * Contains the status and data of a translation operation
 */
export interface AITranslationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Translation data (returned on success) */
  data?: AITranslationEntry;
  /** Error message (returned on failure) */
  error?: string;
  /** Whether the result came from cache */
  cached?: boolean;
}
