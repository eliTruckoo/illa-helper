/**
 * Phonetic provider interface
 * Implements the strategy pattern to support multiple phonetic APIs
 */

import { PhoneticResult } from '../types';

export interface IPhoneticProvider {
  /**
   * Provider name
   */
  readonly name: string;

  /**
   * Get phonetic information for a word
   * @param word Word to look up
   * @returns Promise<PhoneticResult> Phonetic lookup result
   */
  getPhonetic(word: string): Promise<PhoneticResult>;

  /**
   * Get phonetic information in batch
   * @param words Array of words to look up
   * @returns Promise<PhoneticResult[]> Array of phonetic lookup results
   */
  getBatchPhonetics(words: string[]): Promise<PhoneticResult[]>;

  /**
   * Check whether the provider is available
   * @returns Promise<boolean> Whether it is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get provider configuration info
   * @returns The provider's configuration info
   */
  getConfig(): {
    endpoint?: string;
    rateLimitPerMinute?: number;
    supportsBatch?: boolean;
    supportsAudio?: boolean;
  };
}
