/**
 * Web Speech API TTS provider
 * Wraps the browser's native speech synthesis
 */

import { ITTSProvider, TTSProviderConfig } from './ITTSProvider';
import { TTSResult } from '../types';

export class WebSpeechTTSProvider implements ITTSProvider {
  readonly name = 'web-speech';

  /** How long to wait for the asynchronous voice list before speaking anyway */
  private static readonly VOICE_LOAD_TIMEOUT_MS = 1000;

  private config: TTSProviderConfig;
  // Resolved lazily: touching speechSynthesis can start the platform speech
  // backend (speech-dispatcher on Linux), so it must not happen on page load.
  private synthesis: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoading: Promise<void> | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  constructor(config: TTSProviderConfig = {}) {
    this.config = {
      lang: 'en-US',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      ...config,
    };
  }

  /**
   * Get the speech synthesis object, touching it only on first real use
   */
  private getSynthesis(): SpeechSynthesis {
    if (!this.synthesis) {
      this.synthesis = window.speechSynthesis;
    }
    return this.synthesis;
  }

  /**
   * Load the voice list once (some browsers populate it asynchronously)
   */
  private ensureVoicesLoaded(): Promise<void> {
    if (!this.voicesLoading) {
      this.voicesLoading = this.loadVoices(this.getSynthesis());
    }
    return this.voicesLoading;
  }

  /**
   * Load available voices
   */
  private loadVoices(synthesis: SpeechSynthesis): Promise<void> {
    return new Promise((resolve) => {
      this.voices = synthesis.getVoices();
      if (this.voices.length > 0) {
        resolve();
        return;
      }

      const finish = () => {
        synthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        clearTimeout(timeoutId);
        resolve();
      };
      const handleVoicesChanged = () => {
        this.voices = synthesis.getVoices();
        if (this.voices.length > 0) {
          finish();
        }
      };

      // Use addEventListener so a page-owned onvoiceschanged handler is not overwritten
      synthesis.addEventListener('voiceschanged', handleVoicesChanged);
      // Do not wait forever for voices that may never arrive
      const timeoutId = setTimeout(() => {
        this.voices = synthesis.getVoices();
        finish();
      }, WebSpeechTTSProvider.VOICE_LOAD_TIMEOUT_MS);
    });
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

      // Ensure the voice list is loaded (first use initialises speech synthesis)
      await this.ensureVoicesLoaded();
      if (this.voices.length === 0) {
        this.voices = this.getSynthesis().getVoices();
      }

      // Stop current speech
      this.stop();

      const finalConfig = { ...this.config, ...config };
      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;

      // Set voice parameters
      utterance.lang = finalConfig.lang || 'en-US';
      utterance.rate = finalConfig.rate || 1.0;
      utterance.pitch = finalConfig.pitch || 1.0;
      utterance.volume = finalConfig.volume || 1.0;

      // Select a suitable voice
      const voice = this.selectVoice(
        finalConfig.lang || 'en-US',
        finalConfig.voice,
      );
      if (voice) {
        utterance.voice = voice;
      }

      return new Promise((resolve) => {
        utterance.onend = () => {
          this.currentUtterance = null;
          resolve({ success: true });
        };

        utterance.onerror = (event) => {
          this.currentUtterance = null;
          resolve({
            success: false,
            error: `Speech failed: ${event.error}`,
          });
        };

        this.getSynthesis().speak(utterance);
      });
    } catch (error) {
      this.currentUtterance = null;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  stop(): void {
    // Never initialise speech synthesis just to stop it
    if (this.synthesis?.speaking) {
      this.synthesis.cancel();
    }
    this.currentUtterance = null;
  }

  isSpeaking(): boolean {
    return this.synthesis?.speaking ?? false;
  }

  isAvailable(): boolean {
    return 'speechSynthesis' in window;
  }

  updateConfig(config: Partial<TTSProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TTSProviderConfig {
    return { ...this.config };
  }

  /**
   * Get the list of available voices
   */
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  /**
   * Get voices for the given language
   */
  getVoicesByLanguage(lang: string): SpeechSynthesisVoice[] {
    return this.voices.filter((voice) =>
      voice.lang.toLowerCase().startsWith(lang.toLowerCase()),
    );
  }

  /**
   * Select a suitable voice
   */
  private selectVoice(
    lang: string,
    preferredVoice?: string,
  ): SpeechSynthesisVoice | null {
    if (this.voices.length === 0) return null;

    // If a specific voice is requested, try to find it
    if (preferredVoice) {
      const voice = this.voices.find((v) => v.name === preferredVoice);
      if (voice) return voice;
    }

    // Find voices matching the language
    const languageVoices = this.getVoicesByLanguage(lang);
    if (languageVoices.length > 0) {
      // Prefer local voices
      const localVoice = languageVoices.find((v) => v.localService);
      if (localVoice) return localVoice;

      // Otherwise return the first matching voice
      return languageVoices[0];
    }

    return null;
  }
}
