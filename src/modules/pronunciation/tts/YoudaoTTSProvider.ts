/**
 * Youdao Dictionary TTS provider
 * Provides read-aloud using the Youdao Dictionary speech API
 */

import { ITTSProvider, TTSProviderConfig } from './ITTSProvider';
import { TTSResult } from '../types';
import { TIMER_CONSTANTS, API_CONSTANTS } from '../config';

export class YoudaoTTSProvider implements ITTSProvider {
  readonly name = 'youdao';

  private config: TTSProviderConfig;
  private currentAudio: HTMLAudioElement | null = null;

  constructor(config: TTSProviderConfig = {}) {
    this.config = {
      accent: 'us', // default to US pronunciation
      ...config,
    };
  }

  async speak(
    text: string,
    config?: Partial<TTSProviderConfig>,
  ): Promise<TTSResult> {
    try {
      if (!text || typeof text !== 'string') {
        return {
          success: false,
          error: 'Invalid text parameter',
        };
      }

      // Stop current playback
      this.stop();

      const finalConfig = { ...this.config, ...config };
      const accent = finalConfig.accent || 'us';

      // Build the Youdao Dictionary speech URL
      const type = accent === 'us' ? 2 : 1; // 1=UK, 2=US
      const audioUrl = `${API_CONSTANTS.YOUDAO_TTS_BASE_URL}?type=${type}&audio=${encodeURIComponent(text)}`;

      console.log(
        `[DEBUG] Youdao TTS URL: ${audioUrl}, accent: ${accent}, type: ${type}`,
      );

      // Create the audio element
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      return new Promise((resolve) => {
        let isResolved = false;

        // Set a timeout to prevent waiting forever
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.currentAudio = null;
            resolve({
              success: false,
              error: 'Youdao speech loading timed out',
            });
          }
        }, TIMER_CONSTANTS.YOUDAO_TIMEOUT); // Youdao TTS timeout

        const cleanup = () => {
          clearTimeout(timeout);
          this.currentAudio = null;
        };

        audio.onended = () => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({ success: true });
          }
        };

        audio.onerror = (event) => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({
              success: false,
              error: 'Youdao speech playback failed',
            });
          }
        };

        audio.onloadstart = () => {
          // Audio started loading
        };

        audio.oncanplay = () => {
          // Audio can play
          audio.play().catch((error) => {
            if (!isResolved) {
              isResolved = true;
              cleanup();
              resolve({
                success: false,
                error: `Audio playback failed: ${error.message}`,
              });
            }
          });
        };

        // Network error handling
        audio.onabort = () => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({
              success: false,
              error: 'Youdao speech loading was interrupted',
            });
          }
        };

        audio.onstalled = () => {
          // Loading stalled; do not fail immediately, wait for timeout handling
        };

        // Start loading audio
        try {
          audio.load();
        } catch (error) {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            resolve({
              success: false,
              error: `Youdao speech initialization failed: ${error}`,
            });
          }
        }
      });
    } catch (error) {
      this.currentAudio = null;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  isSpeaking(): boolean {
    return this.currentAudio !== null && !this.currentAudio.paused;
  }

  isAvailable(): boolean {
    // Check whether the Audio API is supported
    return typeof Audio !== 'undefined';
  }

  updateConfig(config: Partial<TTSProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TTSProviderConfig {
    return { ...this.config };
  }

  /**
   * Preload audio (optional feature)
   * @param text text to preload
   * @param accent accent type
   */
  async preloadAudio(
    text: string,
    accent: 'us' | 'uk' = 'us',
  ): Promise<boolean> {
    try {
      const type = accent === 'us' ? 2 : 1;
      const audioUrl = `${API_CONSTANTS.YOUDAO_TTS_BASE_URL}?type=${type}&audio=${encodeURIComponent(text)}`;

      const audio = new Audio(audioUrl);

      return new Promise((resolve) => {
        audio.oncanplaythrough = () => {
          resolve(true);
        };

        audio.onerror = () => {
          resolve(false);
        };

        audio.load();
      });
    } catch (_) {
      return false;
    }
  }
}
