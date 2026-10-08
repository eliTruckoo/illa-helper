/**
 * In-page (per-tab) segment translation cache.
 *
 * - Full string keys (no 32-bit hash): provider/model/prompt settings + normalized segment text
 * - LRU eviction
 * - Stores word pairs only; positions are recomputed for every caller, so a cached
 *   result applies to any DOM node with the same text
 * - In-flight coalescing: identical concurrent segments share one request
 * - Failed requests are never cached
 */

import type {
  FullTextAnalysisResponse,
  TranslationResultStatus,
} from '../../shared/types/api';
import { addPositionsToReplacements } from '../../api/utils/textUtils';

export const SEGMENT_CACHE_MAX_ENTRIES = 500;

export interface TranslationPair {
  original: string;
  translation: string;
}

/** Cacheable (successful) translation of one segment */
export interface CachedTranslation {
  status: Exclude<TranslationResultStatus, 'error'>;
  pairs: TranslationPair[];
}

/** Outcome of resolving one segment; errors are returned but never cached */
export type TranslationOutcome =
  | CachedTranslation
  | { status: 'error'; error: string };

export type TranslationOutcomeSource = 'cache' | 'inflight' | 'request';

/** Settings that change the model answer for the same text */
export interface TranslationCacheKeyParts {
  providerId: string;
  protocolFamily?: string;
  endpoint?: string;
  model: string;
  temperature?: number;
  customParams?: string;
  targetLanguage: string;
  userLevel: number | string;
  replacementRate: number;
  promptVersion: string;
}

const ZERO_WIDTH_CHARS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/**
 * Normalize segment text for cache keys only; the model still receives the raw text.
 */
export function normalizeSegmentText(text: string): string {
  return (text || '')
    .normalize('NFC')
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTranslationCacheKey(
  parts: TranslationCacheKeyParts,
  text: string,
): string {
  const settingsKey = JSON.stringify([
    parts.providerId,
    parts.protocolFamily ?? '',
    parts.endpoint ?? '',
    parts.model,
    parts.temperature ?? '',
    parts.customParams?.trim() ?? '',
    parts.targetLanguage,
    parts.userLevel,
    parts.replacementRate,
    parts.promptVersion,
  ]);
  return `${settingsKey}\n${normalizeSegmentText(text)}`;
}

/**
 * Minimal LRU cache on top of Map insertion order.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) {
      return undefined;
    }
    // Refresh recency
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, value);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Convert a provider response into a cacheable outcome (pairs only).
 */
export function toTranslationOutcome(
  response: FullTextAnalysisResponse | null | undefined,
): TranslationOutcome {
  if (!response || response.status === 'error') {
    return {
      status: 'error',
      error: response?.error || 'Translation request failed',
    };
  }

  const pairs = (response.replacements || [])
    .filter((replacement) => replacement.original && replacement.translation)
    .map(({ original, translation }) => ({ original, translation }));

  return { status: pairs.length > 0 ? 'ok' : 'empty', pairs };
}

/**
 * Build a caller-specific response from an outcome, recomputing positions for this exact text.
 */
export function responseFromOutcome(
  text: string,
  outcome: TranslationOutcome,
  replacementRate?: number,
): FullTextAnalysisResponse {
  if (outcome.status === 'error') {
    return {
      original: text,
      processed: text,
      replacements: [],
      status: 'error',
      error: outcome.error,
    };
  }

  const replacements = addPositionsToReplacements(text, outcome.pairs, {
    replacementRate,
  });

  return {
    original: text,
    processed: '',
    replacements,
    status: replacements.length > 0 ? 'ok' : 'empty',
  };
}

export class SegmentTranslationCache {
  private readonly cache: LruCache<CachedTranslation>;
  private readonly inflight = new Map<string, Promise<TranslationOutcome>>();

  constructor(maxEntries: number = SEGMENT_CACHE_MAX_ENTRIES) {
    this.cache = new LruCache<CachedTranslation>(maxEntries);
  }

  /** Cached outcome, if any */
  get(key: string): CachedTranslation | undefined {
    return this.cache.get(key);
  }

  /** Pending request for the key, if any */
  getInflight(key: string): Promise<TranslationOutcome> | undefined {
    return this.inflight.get(key);
  }

  /**
   * Register a pending request. Its successful outcome is cached when it settles,
   * errors are dropped so the next caller retries.
   */
  track(
    key: string,
    request: Promise<TranslationOutcome>,
  ): Promise<TranslationOutcome> {
    const tracked = request
      .catch(
        (error): TranslationOutcome => ({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .then((outcome) => {
        if (outcome.status !== 'error') {
          this.cache.set(key, outcome);
        }
        if (this.inflight.get(key) === tracked) {
          this.inflight.delete(key);
        }
        return outcome;
      });

    this.inflight.set(key, tracked);
    return tracked;
  }

  /**
   * Resolve one key: cache, then in-flight request, then a new request via `fetcher`.
   */
  async resolve(
    key: string,
    fetcher: () => Promise<TranslationOutcome>,
  ): Promise<{
    outcome: TranslationOutcome;
    source: TranslationOutcomeSource;
  }> {
    const cached = this.get(key);
    if (cached) {
      return { outcome: cached, source: 'cache' };
    }

    const pending = this.getInflight(key);
    if (pending) {
      return { outcome: await pending, source: 'inflight' };
    }

    return { outcome: await this.track(key, fetcher()), source: 'request' };
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }
}
