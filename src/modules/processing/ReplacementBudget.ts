import type { Replacement } from '../shared/types/api';
import type { ContentSegment } from './ProcessingStateManager';

const CJK_CHAR_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD_PATTERN = /\p{L}[\p{L}\p{M}]*(?:[-'\u2019][\p{L}\p{M}]+)*/gu;

export function countTranslationUnits(text: string): number {
  const cjkChars = text.match(CJK_CHAR_PATTERN) ?? [];
  // Words of every script that separates words with spaces (Latin, Cyrillic, Greek, Hangul, ...).
  // Without this, non-Latin pages got a limit of 0 and every answer was discarded.
  const words = text.replace(CJK_CHAR_PATTERN, ' ').match(WORD_PATTERN) ?? [];

  // Chinese/Japanese have no natural whitespace word boundaries. Counting per character would noticeably inflate low replacement rates;
  // so we conservatively estimate two characters as roughly one learning unit, avoiding a word-segmentation dependency for the limit.
  return words.length + Math.ceil(cjkChars.length / 2);
}

export function calculateReplacementLimit(
  text: string,
  replacementRate?: number,
): number | undefined {
  if (replacementRate === undefined || Number.isNaN(replacementRate)) {
    return undefined;
  }

  if (replacementRate <= 0) {
    return 0;
  }

  if (replacementRate >= 1) {
    return undefined;
  }

  const unitCount = countTranslationUnits(text);
  if (unitCount === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(unitCount * replacementRate));
}

export class ReplacementBudget {
  private remainingCount: number | undefined;

  private constructor(totalLimit: number | undefined) {
    this.remainingCount = totalLimit;
  }

  static unlimited(): ReplacementBudget {
    return new ReplacementBudget(undefined);
  }

  static fromText(text: string, replacementRate?: number): ReplacementBudget {
    return new ReplacementBudget(
      calculateReplacementLimit(text, replacementRate),
    );
  }

  static fromSegments(
    segments: ContentSegment[],
    replacementRate?: number,
  ): ReplacementBudget {
    const text = segments.map((segment) => segment.textContent).join('');
    return this.fromText(text, replacementRate);
  }

  addSegments(segments: ContentSegment[], replacementRate?: number): void {
    const text = segments.map((segment) => segment.textContent).join('');
    this.addText(text, replacementRate);
  }

  addText(text: string, replacementRate?: number): void {
    if (this.remainingCount === undefined) {
      return;
    }

    const additionalLimit = calculateReplacementLimit(text, replacementRate);
    if (additionalLimit === undefined || additionalLimit <= 0) {
      return;
    }

    this.remainingCount += additionalLimit;
  }

  take<T extends Replacement>(replacements: T[]): T[] {
    if (this.remainingCount === undefined) {
      return replacements;
    }

    if (this.remainingCount <= 0) {
      return [];
    }

    const accepted = replacements.slice(0, this.remainingCount);
    this.remainingCount -= accepted.length;
    return accepted;
  }

  restore(count: number): void {
    if (this.remainingCount === undefined || count <= 0) {
      return;
    }

    this.remainingCount += count;
  }

  getRemainingCount(): number | undefined {
    return this.remainingCount;
  }
}
