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
  // Resolver of the speak() call that is still playing/loading
  private settlePending: ((result: TTSResult) => void) | null = null;

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

        // Settle exactly once and release the audio element
        const settle = (result: TTSResult) => {
          if (isResolved) return;
          isResolved = true;
          clearTimeout(timeout);
          this.detachAudioHandlers(audio);
          if (this.currentAudio === audio) {
            this.currentAudio = null;
          }
          if (this.settlePending === settle) {
            this.settlePending = null;
          }
          resolve(result);
        };
        this.settlePending = settle;

        // Set a timeout to prevent waiting forever
        const timeout = setTimeout(() => {
          this.releaseAudio(audio);
          settle({
            success: false,
            error: 'Youdao speech loading timed out',
          });
        }, TIMER_CONSTANTS.YOUDAO_TIMEOUT); // Youdao TTS timeout

        audio.onended = () => {
          settle({ success: true });
        };

        audio.onerror = () => {
          settle({
            success: false,
            error: 'Youdao speech playback failed',
          });
        };

        audio.oncanplay = () => {
          // Audio can play
          audio.play().catch((error) => {
            settle({
              success: false,
              error: `Audio playback failed: ${error.message}`,
            });
          });
        };

        // Network error handling
        audio.onabort = () => {
          settle({
            success: false,
            error: 'Youdao speech loading was interrupted',
          });
        };

        // Start loading audio
        try {
          audio.load();
        } catch (error) {
          settle({
            success: false,
            error: `Youdao speech initialization failed: ${error}`,
          });
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

  /**
   * Stop playback: release the audio element (clear src + load() aborts the
   * download and frees the media resources), detach its handlers and settle
   * the pending speak() promise as stopped so callers do not fall back.
   */
  stop(): void {
    const audio = this.currentAudio;
    this.currentAudio = null;
    if (audio) {
      this.detachAudioHandlers(audio);
      this.releaseAudio(audio);
    }

    this.settlePending?.({ success: true, stopped: true });
    this.settlePending = null;
  }

  private detachAudioHandlers(audio: HTMLAudioElement): void {
    audio.onended = null;
    audio.onerror = null;
    audio.oncanplay = null;
    audio.onabort = null;
  }

  private releaseAudio(audio: HTMLAudioElement): void {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // The element is being discarded anyway
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
