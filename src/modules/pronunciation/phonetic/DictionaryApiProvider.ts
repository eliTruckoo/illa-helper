/**
 * Dictionary API provider implementation
 * Calls https://api.dictionaryapi.dev/api/v2/entries/en/ to get phonetic info
 */

import { IPhoneticProvider } from './IPhoneticProvider';
import {
  PhoneticResult,
  PhoneticInfo,
  PhoneticEntry,
  MeaningEntry,
  DefinitionEntry,
} from '../types';
import { API_CONSTANTS } from '../config';
import { LookupCache, LookupOutcome } from '../utils/LookupCache';

export class DictionaryApiProvider implements IPhoneticProvider {
  readonly name = 'dictionary-api';
  private readonly baseUrl = API_CONSTANTS.DICTIONARY_API_BASE_URL;
  private readonly cacheTTL = API_CONSTANTS.AI_TRANSLATION_CACHE_TTL;
  // Results, 404s and errors are cached; concurrent hovers share one request
  private readonly lookups = new LookupCache<PhoneticInfo>({
    maxEntries: 1000,
  });

  /**
   * Get phonetic info for a word
   */
  async getPhonetic(word: string): Promise<PhoneticResult> {
    try {
      // Data validation
      if (!word || typeof word !== 'string') {
        return {
          success: false,
          error: 'Invalid word parameter',
        };
      }

      const cleanWord = word.toLowerCase().trim();
      const result = await this.lookups.resolve(cleanWord, () =>
        this.fetchPhonetic(cleanWord),
      );

      return result.ok
        ? { success: true, data: result.data, cached: result.cached }
        : { success: false, error: result.error };
    } catch (error) {
      console.error('Failed to get phonetics:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch one word from the Dictionary API and classify the outcome for caching
   */
  private async fetchPhonetic(
    cleanWord: string,
  ): Promise<LookupOutcome<PhoneticInfo>> {
    try {
      const response = await fetch(
        `${this.baseUrl}${encodeURIComponent(cleanWord)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          // Only the word is sent, never the page it was found on
          referrerPolicy: 'no-referrer',
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          // The word is not in the dictionary; this will not change soon
          return {
            ok: false,
            error: `No phonetics found for this word in the dictionary`,
            ttlMs: API_CONSTANTS.NOT_FOUND_CACHE_TTL,
          };
        }
        return {
          ok: false,
          error: `API request failed: ${response.status} ${response.statusText}`,
          ttlMs: API_CONSTANTS.LOOKUP_ERROR_CACHE_TTL,
        };
      }

      const data = await response.json();
      return {
        ok: true,
        data: this.parseApiResponse(data, cleanWord),
        ttlMs: this.cacheTTL,
      };
    } catch (error) {
      console.error('Failed to get phonetics:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        ttlMs: API_CONSTANTS.LOOKUP_ERROR_CACHE_TTL,
      };
    }
  }

  /**
   * Get phonetic info in batch
   */
  async getBatchPhonetics(words: string[]): Promise<PhoneticResult[]> {
    // Dictionary API does not support batch requests, use concurrent single requests
    const promises = words.map((word) => this.getPhonetic(word));
    return Promise.all(promises);
  }

  /**
   * Check whether the provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const testResponse = await fetch(`${this.baseUrl}hello`, {
        method: 'HEAD',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      return testResponse.ok || testResponse.status === 404; // 404 also means the API is available
    } catch {
      return false;
    }
  }

  /**
   * Get provider configuration
   */
  getConfig() {
    return {
      endpoint: this.baseUrl,
      rateLimitPerMinute: 450, // Dictionary API limit
      supportsBatch: false,
      supportsAudio: true,
    };
  }

  /**
   * Parse the API response data
   */
  private parseApiResponse(data: any[], word: string): PhoneticInfo {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid API response data format');
    }

    const entry = data[0]; // take the first entry
    const phonetics: PhoneticEntry[] = [];
    const meanings: MeaningEntry[] = [];

    // Parse phonetics
    if (entry.phonetics && Array.isArray(entry.phonetics)) {
      entry.phonetics.forEach((phonetic: any) => {
        if (phonetic.text || phonetic.audio) {
          phonetics.push({
            text: phonetic.text,
            audio: phonetic.audio,
            sourceUrl: phonetic.sourceUrl,
          });
        }
      });
    }

    // Parse definitions
    if (entry.meanings && Array.isArray(entry.meanings)) {
      entry.meanings.forEach((meaning: any) => {
        if (meaning.partOfSpeech && meaning.definitions) {
          const definitions: DefinitionEntry[] = meaning.definitions.map(
            (def: any) => ({
              definition: def.definition || '',
              example: def.example,
              synonyms: def.synonyms,
            }),
          );

          meanings.push({
            partOfSpeech: meaning.partOfSpeech,
            definitions,
          });
        }
      });
    }

    return {
      word,
      phonetics,
      meanings,
    };
  }
}
