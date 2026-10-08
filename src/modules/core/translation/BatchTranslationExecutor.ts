/**
 * Resolves many segments with as few requests as possible:
 * in-page cache -> in-flight request -> duplicates within the call -> numbered batch requests,
 * with per-item fallback to single requests for items the batch did not answer.
 */

import type {
  BatchAnalysisResponse,
  FullTextAnalysisResponse,
} from '../../shared/types/api';
import { getResponseStatus } from '../../api/utils/apiUtils';
import {
  SegmentTranslationCache,
  toTranslationOutcome,
  type TranslationOutcome,
} from './SegmentTranslationCache';
import { translationStats } from './TranslationStats';
import type { TranslationHint } from '../../processing/ProcessingContracts';

export interface BatchTranslationBackend {
  /**
   * One request for one segment; must not reject.
   * @param alreadyHandled page glossary words the model should not output (prompt hint)
   */
  translateOne(
    text: string,
    alreadyHandled?: string[],
  ): Promise<TranslationOutcome>;
  /** One request for several segments; may reject or return status 'error' */
  translateMany(
    texts: string[],
    alreadyHandled?: Array<string[] | undefined>,
  ): Promise<BatchAnalysisResponse>;
}

export interface BatchTranslationOptions {
  maxItems: number;
  maxChars: number;
}

interface PendingItem {
  key: string;
  text: string;
  hint?: TranslationHint;
}

/**
 * Errors where retrying every item on its own would only repeat the failure (auth, quota, rate limit).
 */
const NON_RETRYABLE_BATCH_ERROR = /\b(401|402|403|429)\b|api key/i;

/** Words of a hint as sent in the prompt */
export function hintWords(hint?: TranslationHint): string[] | undefined {
  return hint && hint.pairs.length > 0
    ? hint.pairs.map((pair) => pair.original)
    : undefined;
}

/**
 * Add the hinted glossary pairs to an answer that was requested with the "already handled" hint.
 *
 * The cache key (in-page and persistent) is the normalized text WITHOUT the hint, so the stored pairs
 * must describe the whole text: the model skipped the hinted words only because the glossary covers
 * them. Storing LLM pairs + hinted pairs keeps a later cache hit complete (also on a page without the
 * glossary). Hinted pairs are added only up to the segment's replacement limit so they never push
 * model picks out of the rate cap. Errors are returned unchanged.
 */
export function withHintPairs(
  outcome: TranslationOutcome,
  hint?: TranslationHint,
): TranslationOutcome {
  if (!hint || hint.pairs.length === 0 || outcome.status === 'error') {
    return outcome;
  }

  const pairs = [...outcome.pairs];
  const room =
    hint.maxPairs === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, hint.maxPairs - pairs.length);
  const present = new Set(pairs.map((pair) => pair.original));
  let added = 0;

  for (const pair of hint.pairs) {
    if (added >= room) {
      break;
    }
    if (!pair.original || !pair.translation || present.has(pair.original)) {
      continue;
    }
    present.add(pair.original);
    pairs.push({ original: pair.original, translation: pair.translation });
    added++;
  }

  return { status: pairs.length > 0 ? 'ok' : 'empty', pairs };
}

/**
 * Split items into requests of at most `maxItems` items and about `maxChars` characters, keeping order.
 * A single item longer than `maxChars` still gets its own request.
 */
export function chunkBatchItems<T extends { text: string }>(
  items: T[],
  maxItems: number,
  maxChars: number,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const length = item.text.length;
    const full =
      current.length >= Math.max(1, maxItems) ||
      (current.length > 0 && currentChars + length > maxChars);
    if (full) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export class BatchTranslationExecutor {
  constructor(
    private readonly cache: SegmentTranslationCache,
    private readonly backend: BatchTranslationBackend,
    private readonly options: BatchTranslationOptions,
  ) {}

  /**
   * Resolve one outcome per text, in input order.
   * @param texts raw segment texts (sent to the model as-is)
   * @param keys cache keys, one per text
   * @param hints optional page glossary hints, one per text (see withHintPairs)
   */
  async translate(
    texts: string[],
    keys: string[],
    hints?: Array<TranslationHint | undefined>,
  ): Promise<TranslationOutcome[]> {
    const byKey = new Map<string, Promise<TranslationOutcome>>();
    const pending: PendingItem[] = [];
    const pendingKeys = new Set<string>();

    texts.forEach((text, index) => {
      const key = keys[index];
      if (byKey.has(key) || pendingKeys.has(key)) {
        // Identical segment within this call
        translationStats.recordCoalesced();
        return;
      }

      const cached = this.cache.get(key);
      if (cached) {
        translationStats.recordCacheHit();
        byKey.set(key, Promise.resolve(cached));
        return;
      }

      const inflight = this.cache.getInflight(key);
      if (inflight) {
        translationStats.recordCoalesced();
        byKey.set(key, inflight);
        return;
      }

      pendingKeys.add(key);
      pending.push({ key, text, hint: hints?.[index] });
    });

    const chunks = chunkBatchItems(
      pending,
      this.options.maxItems,
      this.options.maxChars,
    );
    for (const chunk of chunks) {
      const chunkOutcomes = this.requestChunk(chunk);
      chunk.forEach((item, position) => {
        byKey.set(
          item.key,
          this.cache.track(
            item.key,
            chunkOutcomes.then((outcomes) =>
              withHintPairs(outcomes[position], item.hint),
            ),
          ),
        );
      });
    }

    return Promise.all(keys.map((key) => byKey.get(key)!));
  }

  /**
   * One batch request for the chunk; unanswered items and failed batches fall back to single requests.
   */
  private async requestChunk(
    chunk: PendingItem[],
  ): Promise<TranslationOutcome[]> {
    if (chunk.length === 1) {
      return [
        await this.backend.translateOne(
          chunk[0].text,
          hintWords(chunk[0].hint),
        ),
      ];
    }

    let response: BatchAnalysisResponse;
    try {
      const alreadyHandled = chunk.map((item) => hintWords(item.hint));
      response = await this.backend.translateMany(
        chunk.map((item) => item.text),
        alreadyHandled.some(Boolean) ? alreadyHandled : undefined,
      );
    } catch (error) {
      response = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        items: [],
      };
    }

    if (
      response.status === 'error' &&
      NON_RETRYABLE_BATCH_ERROR.test(response.error || '')
    ) {
      const outcome: TranslationOutcome = {
        status: 'error',
        error: response.error || 'Batch request failed',
      };
      return chunk.map(() => outcome);
    }

    return Promise.all(
      chunk.map((item, position) => {
        const answer: FullTextAnalysisResponse | undefined =
          response.status === 'ok' ? response.items[position] : undefined;
        if (answer && getResponseStatus(answer) !== 'error') {
          return toTranslationOutcome(answer);
        }
        // Missing from the answer, or the whole batch failed: retry this item on its own
        return this.backend.translateOne(item.text, hintWords(item.hint));
      }),
    );
  }
}
