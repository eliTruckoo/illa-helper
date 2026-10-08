/**
 * Pronunciation module constants
 */

// UI-related constants
export const UI_CONSTANTS = {
  TOOLTIP_Z_INDEX: 10000,
  WORD_TOOLTIP_Z_INDEX: 10001,
  TOOLTIP_PADDING: 12,
  TOOLTIP_ARROW_SIZE: 8,
} as const;

// Timer-related constants
export const TIMER_CONSTANTS = {
  SHOW_DELAY: 300, // Show delay (ms)
  HIDE_DELAY: 600, // Hide delay (ms)
  WORD_SHOW_DELAY: 100, // Word tooltip show delay (ms)
  YOUDAO_TIMEOUT: 10000, // Youdao TTS timeout (ms)
} as const;

// CSS class name constants
export const CSS_CLASSES = {
  PRONUNCIATION_ENABLED: 'wxt-pronunciation-enabled',
  PRONUNCIATION_LOADING: 'wxt-pronunciation-loading',
  PHONETIC_INLINE: 'wxt-phonetic-inline',
  PRONUNCIATION_TOOLTIP: 'wxt-pronunciation-tooltip',
  WORD_TOOLTIP: 'wxt-word-tooltip',
  INTERACTIVE_WORD: 'wxt-interactive-word',
  MEANING_CONTAINER: 'wxt-meaning-container', // Added: meaning container
  MEANING_TEXT: 'wxt-meaning-text', // Added: meaning text
  MEANING_LOADING: 'wxt-meaning-loading', // Added: meaning loading state
  PHONETIC_LOADING: 'wxt-phonetic-loading', // Added: phonetic loading state
} as const;

// SVG icon constants
export const SVG_ICONS = {
  SPEAKER: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
  SPEAKER_SMALL: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
} as const;

// API-related constants
export const API_CONSTANTS = {
  YOUDAO_TTS_BASE_URL: 'https://dict.youdao.com/dictvoice',
  DICTIONARY_API_BASE_URL: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
  AI_TRANSLATION_CACHE_TTL: 86400000, // AI translation cache: 24 hours
  NOT_FOUND_CACHE_TTL: 7 * 86400000, // Words the dictionary does not know (404): 7 days
  LOOKUP_ERROR_CACHE_TTL: 10 * 60000, // Failed lookups (network/API errors): 10 minutes
} as const;
