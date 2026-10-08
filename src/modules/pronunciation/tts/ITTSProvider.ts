/**
 * TTS provider interface
 * Defines the unified text-to-speech service contract
 */

import { TTSResult } from '../types';

export interface TTSProviderConfig {
  // Web Speech API configuration
  lang?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;

  // Youdao TTS configuration
  accent?: 'us' | 'uk'; // US or UK pronunciation
}

export interface ITTSProvider {
  readonly name: string;

  /**
   * Read text aloud
   * @param text Text to read aloud
   * @param config Optional configuration override
   */
  speak(text: string, config?: Partial<TTSProviderConfig>): Promise<TTSResult>;

  /**
   * Stop reading aloud
   */
  stop(): void;

  /**
   * Check whether reading aloud is in progress
   */
  isSpeaking(): boolean;

  /**
   * Check whether TTS is available
   */
  isAvailable(): boolean;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSProviderConfig>): void;

  /**
   * Get the current configuration
   */
  getConfig(): TTSProviderConfig;
}
