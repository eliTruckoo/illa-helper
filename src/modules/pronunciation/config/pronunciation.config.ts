/**
 * Pronunciation module configuration
 */

import type { TooltipHotkey } from '../../shared/types/ui';
import { DEFAULT_PRONUNCIATION_HOTKEY } from '../../shared/constants/defaults';

// TTS configuration
export interface TTSConfig {
  provider: 'web-speech' | 'youdao';
  // Web Speech API configuration
  lang?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  // Youdao TTS configuration
  accent?: 'us' | 'uk'; // US or UK pronunciation
}

// Pronunciation UI configuration
export interface PronunciationUIConfig {
  showPhonetic: boolean;
  showPlayButton: boolean;
  tooltipEnabled: boolean;
  inlineDisplay: boolean;
  hotkey?: TooltipHotkey; // Hotkey configuration
}

// Pronunciation service configuration
export interface PronunciationConfig {
  // The phonetic source is fixed to the Dictionary API. No fake provider config is exposed here, to avoid invalid state in the storage layer.
  ttsConfig: TTSConfig;
  uiConfig: PronunciationUIConfig;
}

// Default TTS configuration
export const DEFAULT_TTS_CONFIG: TTSConfig = {
  provider: 'youdao',
  lang: 'en-US',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  accent: 'us',
};

// Default UI configuration
export const DEFAULT_UI_CONFIG: PronunciationUIConfig = {
  showPhonetic: true,
  showPlayButton: true,
  tooltipEnabled: true,
  inlineDisplay: false, // Disable inline display; show only in the tooltip
  hotkey: DEFAULT_PRONUNCIATION_HOTKEY,
};

// Default pronunciation configuration
export const DEFAULT_PRONUNCIATION_CONFIG: PronunciationConfig = {
  ttsConfig: DEFAULT_TTS_CONFIG,
  uiConfig: DEFAULT_UI_CONFIG,
};
