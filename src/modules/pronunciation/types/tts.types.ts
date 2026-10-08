/**
 * TTS-related type definitions
 */

// TTS result
export interface TTSResult {
  success: boolean;
  error?: string;
}

// TTS provider type
export type TTSProviderType = 'web-speech' | 'youdao';

// TTS provider status
export interface TTSProviderStatus {
  name: string;
  available: boolean;
  speaking: boolean;
}
