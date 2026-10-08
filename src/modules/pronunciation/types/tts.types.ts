/**
 * TTS-related type definitions
 */

// TTS result
export interface TTSResult {
  success: boolean;
  error?: string;
  /** Playback was stopped on purpose (e.g. a newer request); not a failure */
  stopped?: boolean;
}

// TTS provider type
export type TTSProviderType = 'web-speech' | 'youdao';

// TTS provider status
export interface TTSProviderStatus {
  name: string;
  available: boolean;
  speaking: boolean;
}
