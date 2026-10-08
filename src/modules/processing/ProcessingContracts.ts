import type { FullTextAnalysisResponse } from '../shared/types/api';
import type { PageGlossary } from './PageGlossary';

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

/**
 * Page glossary words already handled in one segment ("Already handled, do not output: ..." prompt hint).
 */
export interface TranslationHint {
  /** Glossary pairs present in the segment text; the model is asked not to output them */
  pairs: Array<{ original: string; translation: string }>;
  /** The segment's replacement limit; caps how many hint pairs are stored with the answer */
  maxPairs?: number;
}

/**
 * Page glossary settings for a coordinator run (absent = glossary disabled).
 */
export interface PageGlossaryRunOptions {
  glossary: PageGlossary;
  /** Send the "already handled" hint with each segment */
  promptHint: boolean;
  /** Skip the request for segments the glossary alone fills (never two in a row) */
  economyMode: boolean;
}

export interface TranslationStyleProvider {
  getCurrentStyleClass(): string;
}

export interface TextReplacementEngine {
  readonly styleManager: TranslationStyleProvider;
  replaceText(
    text: string,
    hint?: TranslationHint,
  ): Promise<FullTextAnalysisResponse>;
  /**
   * Translate several segments, batching and deduplicating requests.
   * Returns one response per input text, in input order. Optional: the coordinator
   * falls back to replaceText per segment when it is missing.
   */
  replaceTexts?(
    texts: string[],
    hints?: Array<TranslationHint | undefined>,
  ): Promise<FullTextAnalysisResponse[]>;
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
