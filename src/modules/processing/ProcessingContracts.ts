import type { FullTextAnalysisResponse } from '../shared/types/api';

/**
 * Word-mode batching: several unique segments are sent in one numbered request.
 * Set TRANSLATION_BATCH_MAX_ITEMS to 1 to fall back to one request per segment.
 */
export const TRANSLATION_BATCH_MAX_ITEMS = 8;
/** Maximum characters of segment text per batch request */
export const TRANSLATION_BATCH_MAX_CHARS = 2500;
/** Segments the coordinator hands over at once (about 4 full batch requests) */
export const TRANSLATION_WAVE_SIZE = Math.max(
  8,
  TRANSLATION_BATCH_MAX_ITEMS * 4,
);

export interface TranslationStyleProvider {
  getCurrentStyleClass(): string;
}

export interface TextReplacementEngine {
  readonly styleManager: TranslationStyleProvider;
  replaceText(text: string): Promise<FullTextAnalysisResponse>;
  /**
   * Translate several segments, batching and deduplicating requests.
   * Returns one response per input text, in input order. Optional: the coordinator
   * falls back to replaceText per segment when it is missing.
   */
  replaceTexts?(texts: string[]): Promise<FullTextAnalysisResponse[]>;
  getConfig(): {
    replacementRate?: number;
  };
}

export interface PronunciationRegistrar {
  addPronunciationToElement(
    element: HTMLElement,
    word: string,
    isPhrase?: boolean,
  ): Promise<boolean>;
}
