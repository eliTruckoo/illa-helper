/**
 * Page glossary (opt-in): remembers the word translations already shown on this page and reuses them.
 *
 * - Learns only LLM-chosen pairs that were actually applied to the DOM, keyed by their exact surface form
 *   (case-sensitive; runs of whitespace are treated as one space)
 * - A surface form that comes back with a different translation is marked conflicted and never reused
 *   (polysemy: "bank" of a river vs. a bank)
 * - Scripts without spaces between words (CJK, Thai, ...) are never learned: a substring match there
 *   cannot be told apart from a part of a longer word
 * - Matches use Unicode word boundaries and positions in the raw text they were searched in
 *
 * Owned per page by ProcessingService (next to the page replacement budget), not by a single run.
 */

import type { Replacement } from '../shared/types/api';
import { planStableReplacements } from './ReplacementPlanner';
import { limitReplacementsByRate } from '../api/utils/textUtils';

export interface GlossaryPair {
  original: string;
  translation: string;
}

export interface GlossaryMatch extends GlossaryPair {
  position: {
    start: number;
    end: number;
  };
}

export interface PageGlossaryOptions {
  /** Maximum learned surface forms; later pairs are ignored once full (keeps reuse stable) */
  maxEntries?: number;
}

/** Default number of learned surface forms per page */
export const PAGE_GLOSSARY_MAX_ENTRIES = 1000;
/** Minimum original length (code points) for scripts that separate words with spaces */
export const PAGE_GLOSSARY_MIN_LENGTH = 3;
/** Longer originals are sentences rather than vocabulary */
const PAGE_GLOSSARY_MAX_LENGTH = 64;
/** Alternatives per compiled regular expression */
const MATCHER_CHUNK_SIZE = 200;
/** Words listed in one "already handled" prompt hint */
export const GLOSSARY_HINT_MAX_WORDS = 10;

/** Scripts written without spaces between words */
const NO_WORD_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;
const HAS_LETTER = /\p{L}/u;
/** Syntax characters that must be escaped in a unicode-mode regular expression */
const REGEX_SYNTAX_CHARS = /[\\^$.*+?()[\]{}|/]/g;
const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

/** Glossary key of a surface form: exact text with whitespace runs collapsed */
function toGlossaryKey(original: string): string {
  return original.replace(/\s+/g, ' ');
}

function sameTranslation(a: string, b: string): boolean {
  return (
    a.trim().normalize('NFC').toLocaleLowerCase() ===
    b.trim().normalize('NFC').toLocaleLowerCase()
  );
}

/** Regex source for one surface form; inner whitespace matches any whitespace run of the raw DOM text */
function toPatternSource(key: string): string {
  return key
    .split(' ')
    .map((part) => part.replace(REGEX_SYNTAX_CHARS, '\\$&'))
    .join('\\s+');
}

/**
 * Whether a pair may be learned. Exported for tests.
 */
export function isLearnablePair(pair: GlossaryPair): boolean {
  const original = pair?.original;
  const translation = pair?.translation;
  if (!original || !translation || !translation.trim()) {
    return false;
  }
  if (original !== original.trim() || /[\r\n]/.test(original)) {
    return false;
  }
  const length = [...original].length;
  if (length < PAGE_GLOSSARY_MIN_LENGTH || length > PAGE_GLOSSARY_MAX_LENGTH) {
    return false;
  }
  if (!HAS_LETTER.test(original) || NO_WORD_SPACE_SCRIPT.test(original)) {
    return false;
  }
  return original.trim() !== translation.trim();
}

export class PageGlossary {
  private readonly entries = new Map<string, string>();
  private readonly conflicted = new Set<string>();
  private readonly maxEntries: number;
  private matchers: RegExp[] | null = null;

  constructor(options: PageGlossaryOptions = {}) {
    this.maxEntries = options.maxEntries ?? PAGE_GLOSSARY_MAX_ENTRIES;
  }

  /**
   * Learn applied LLM pairs. Returns the number of newly learned surface forms.
   */
  learn(pairs: GlossaryPair[]): number {
    let learned = 0;

    for (const pair of pairs) {
      if (!isLearnablePair(pair)) {
        continue;
      }

      const key = toGlossaryKey(pair.original);
      if (this.conflicted.has(key)) {
        continue;
      }

      const known = this.entries.get(key);
      if (known !== undefined) {
        if (!sameTranslation(known, pair.translation)) {
          // Same surface form, different sense: stop reusing it on this page
          this.entries.delete(key);
          this.conflicted.add(key);
          this.matchers = null;
        }
        continue;
      }

      if (this.entries.size >= this.maxEntries) {
        continue;
      }

      this.entries.set(key, pair.translation.trim());
      this.matchers = null;
      learned++;
    }

    return learned;
  }

  /** Reusable translation of a surface form, if any */
  lookup(original: string): string | undefined {
    return original ? this.entries.get(toGlossaryKey(original)) : undefined;
  }

  isConflicted(original: string): boolean {
    return this.conflicted.has(toGlossaryKey(original));
  }

  /**
   * All non-overlapping glossary occurrences in `text`, in text order (longest form wins at a position).
   * Positions are relative to `text` itself, so pass the raw text-node text the DOM writer uses.
   */
  findIn(text: string): GlossaryMatch[] {
    if (!text || this.entries.size === 0) {
      return [];
    }

    const candidates: GlossaryMatch[] = [];
    for (const matcher of this.getMatchers()) {
      matcher.lastIndex = 0;
      for (const match of text.matchAll(matcher)) {
        const original = match[1];
        const translation = this.lookup(original);
        if (match.index === undefined || translation === undefined) {
          continue;
        }
        candidates.push({
          original,
          translation,
          position: { start: match.index, end: match.index + original.length },
        });
      }
    }

    // Chunks are matched independently: resolve overlaps across them, longest first at each start
    candidates.sort(
      (a, b) =>
        a.position.start - b.position.start ||
        b.position.end - b.position.start - (a.position.end - a.position.start),
    );
    const result: GlossaryMatch[] = [];
    let occupiedUntil = -1;
    for (const candidate of candidates) {
      if (candidate.position.start >= occupiedUntil) {
        result.push(candidate);
        occupiedUntil = candidate.position.end;
      }
    }
    return result;
  }

  /**
   * Distinct glossary pairs present in `text` for the "already handled" prompt hint, in text order.
   * Forms containing a comma are left out because the hint is a comma-separated list.
   */
  hintFor(
    text: string,
    maxWords: number = GLOSSARY_HINT_MAX_WORDS,
  ): GlossaryPair[] {
    const seen = new Set<string>();
    const pairs: GlossaryPair[] = [];
    for (const match of this.findIn(text)) {
      if (pairs.length >= maxWords) {
        break;
      }
      const key = toGlossaryKey(match.original);
      if (seen.has(key) || key.includes(',')) {
        continue;
      }
      seen.add(key);
      pairs.push({ original: key, translation: match.translation });
    }
    return pairs;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.conflicted.clear();
    this.matchers = null;
  }

  private getMatchers(): RegExp[] {
    if (this.matchers) {
      return this.matchers;
    }

    // Longest first so the alternation prefers "New York" over "New"
    const keys = [...this.entries.keys()].sort((a, b) => b.length - a.length);
    const matchers: RegExp[] = [];
    for (let i = 0; i < keys.length; i += MATCHER_CHUNK_SIZE) {
      const alternation = keys
        .slice(i, i + MATCHER_CHUNK_SIZE)
        .map(toPatternSource)
        .join('|');
      matchers.push(
        new RegExp(
          `${WORD_BOUNDARY_BEFORE}(${alternation})${WORD_BOUNDARY_AFTER}`,
          'gu',
        ),
      );
    }
    this.matchers = matchers;
    return matchers;
  }
}

function overlapsAny(
  ranges: Array<{ position: { start: number; end: number } }>,
  position: { start: number; end: number },
): boolean {
  return ranges.some(
    (range) =>
      position.start < range.position.end &&
      position.end > range.position.start,
  );
}

/**
 * Glossary replacements for a segment: one per surface form (its first occurrence), never overlapping
 * `taken` and never repeating a form already in `taken`. Marked `isNew: false`.
 */
export function selectGlossaryReplacements(
  matches: GlossaryMatch[],
  taken: Replacement[] = [],
): Replacement[] {
  const usedForms = new Set(taken.map((r) => toGlossaryKey(r.original)));
  const selected: Replacement[] = [];

  for (const match of matches) {
    const key = toGlossaryKey(match.original);
    if (usedForms.has(key) || overlapsAny(taken, match.position)) {
      continue;
    }
    usedForms.add(key);
    selected.push({
      original: match.original,
      translation: match.translation,
      position: { ...match.position },
      isNew: false,
    });
  }

  return selected;
}

/**
 * Merge the LLM picks of a segment with glossary matches.
 *
 * - LLM picks win: glossary matches overlapping them (or repeating their form) are dropped
 * - LLM picks the glossary already knows with the same translation (e.g. glossary pairs stored with a
 *   cached answer, see BatchTranslationExecutor.withHintPairs) are re-placed by the word-boundary search
 *   and become glossary replacements (`isNew: false`)
 * - The result is capped by the segment's replacement rate, LLM picks first
 *
 * @param rawText raw text-node text (positions of the result refer to it)
 * @param segmentText text the replacement limit is computed from (the text sent to the model)
 * @returns replacements in priority order (LLM first), positions relative to `rawText`
 */
export function mergeWithGlossary(
  rawText: string,
  segmentText: string,
  llmReplacements: Replacement[],
  glossary: PageGlossary,
  replacementRate?: number,
): Replacement[] {
  const novel = llmReplacements.filter((replacement) => {
    const known = glossary.lookup(replacement.original);
    return (
      known === undefined || !sameTranslation(known, replacement.translation)
    );
  });
  const resolvedNovel = planStableReplacements(rawText, novel);
  const fromGlossary = selectGlossaryReplacements(
    glossary.findIn(rawText),
    resolvedNovel,
  );

  return limitReplacementsByRate(
    segmentText,
    [...resolvedNovel, ...fromGlossary],
    replacementRate,
  );
}
