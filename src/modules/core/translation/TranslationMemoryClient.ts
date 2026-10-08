/**
 * Content-side client of the background translation memory.
 *
 * - Lookups issued in the same tick are merged into one `tm-lookup` message per fingerprint.
 * - Stores are buffered briefly and sent as one `tm-store` message.
 * - Fail open: no background, a timeout, or a malformed reply is a miss; translation
 *   must never wait long for or depend on the cache.
 */

import type { CachedTranslation } from './SegmentTranslationCache';
import {
  TM_MAX_TEXTS_PER_MESSAGE,
  TM_MESSAGE_TYPES,
  type TmHit,
  type TmStoreItem,
} from './TranslationMemoryShared';

export type TmSend = (message: unknown) => Promise<unknown>;

/** A lookup slower than this is treated as a miss */
export const TM_LOOKUP_TIMEOUT_MS = 1500;
/** Stores are collected for this long before one message is sent */
export const TM_STORE_DELAY_MS = 300;

export interface TranslationMemoryClientOptions {
  lookupTimeoutMs?: number;
  storeDelayMs?: number;
}

interface PendingLookup {
  texts: string[];
  resolve: (hits: Array<CachedTranslation | null>) => void;
}

/**
 * The translation memory as seen by one translation run (fingerprint already bound).
 */
export interface TranslationMemoryLayer {
  /** One result per text, null = miss; never rejects */
  lookup(texts: string[]): Promise<Array<CachedTranslation | null>>;
  /** Remember successful outcomes (fire and forget) */
  store(items: Array<{ text: string; outcome: CachedTranslation }>): void;
}

// `browser` is WXT's auto-imported extension API (chrome.* on Chromium)
const defaultSend: TmSend = async (message) => {
  if (typeof browser?.runtime?.sendMessage !== 'function') {
    throw new Error('Extension runtime is not available');
  }
  return browser.runtime.sendMessage(message);
};

/**
 * Convert a wire hit into a cached outcome; anything malformed is a miss.
 */
export function hitToCachedTranslation(hit: unknown): CachedTranslation | null {
  const candidate = hit as TmHit | null | undefined;
  if (
    !candidate ||
    (candidate.status !== 'ok' && candidate.status !== 'empty') ||
    !Array.isArray(candidate.pairs)
  ) {
    return null;
  }

  const pairs = candidate.pairs
    .filter(
      (pair) =>
        Array.isArray(pair) &&
        typeof pair[0] === 'string' &&
        typeof pair[1] === 'string' &&
        pair[0] &&
        pair[1],
    )
    .map(([original, translation]) => ({ original, translation }));

  if (candidate.status === 'ok' && pairs.length === 0) {
    return null;
  }
  return { status: pairs.length > 0 ? 'ok' : 'empty', pairs };
}

export class TranslationMemoryClient {
  private readonly send: TmSend;
  private readonly lookupTimeoutMs: number;
  private readonly storeDelayMs: number;

  private pendingLookups = new Map<string, PendingLookup[]>();
  private lookupTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingStores = new Map<string, TmStoreItem[]>();
  private storeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    send: TmSend = defaultSend,
    options: TranslationMemoryClientOptions = {},
  ) {
    this.send = send;
    this.lookupTimeoutMs = options.lookupTimeoutMs ?? TM_LOOKUP_TIMEOUT_MS;
    this.storeDelayMs = options.storeDelayMs ?? TM_STORE_DELAY_MS;
  }

  /**
   * Look up texts under one fingerprint. Never rejects.
   */
  lookup(
    fp: string,
    texts: string[],
  ): Promise<Array<CachedTranslation | null>> {
    if (texts.length === 0) return Promise.resolve([]);

    return new Promise((resolve) => {
      const queue = this.pendingLookups.get(fp) ?? [];
      queue.push({ texts, resolve });
      this.pendingLookups.set(fp, queue);
      if (this.lookupTimer === null) {
        this.lookupTimer = setTimeout(() => this.flushLookups(), 0);
      }
    });
  }

  /**
   * Queue successful outcomes for storage. Errors are never passed here.
   */
  store(
    fp: string,
    items: Array<{ text: string; outcome: CachedTranslation }>,
  ): void {
    if (items.length === 0) return;
    const queue = this.pendingStores.get(fp) ?? [];
    for (const { text, outcome } of items) {
      if (outcome.status !== 'ok' && outcome.status !== 'empty') continue;
      queue.push({
        text,
        status: outcome.status,
        pairs: outcome.pairs.map((pair) => [pair.original, pair.translation]),
      });
    }
    this.pendingStores.set(fp, queue);
    this.listenForPageHide();
    if (this.storeTimer === null) {
      this.storeTimer = setTimeout(() => {
        void this.flushStores();
      }, this.storeDelayMs);
    }
  }

  /** Send buffered stores now (e.g. on pagehide) */
  async flushStores(): Promise<void> {
    if (this.storeTimer !== null) {
      clearTimeout(this.storeTimer);
      this.storeTimer = null;
    }
    const batches = this.pendingStores;
    this.pendingStores = new Map();

    const sends: Promise<unknown>[] = [];
    for (const [fp, items] of batches) {
      for (let i = 0; i < items.length; i += TM_MAX_TEXTS_PER_MESSAGE) {
        sends.push(
          this.send({
            type: TM_MESSAGE_TYPES.STORE,
            fp,
            items: items.slice(i, i + TM_MAX_TEXTS_PER_MESSAGE),
          }).catch(() => undefined),
        );
      }
    }
    await Promise.all(sends);
  }

  /** Drop everything that was not sent yet (content script teardown) */
  dispose(): void {
    if (this.lookupTimer !== null) clearTimeout(this.lookupTimer);
    if (this.storeTimer !== null) clearTimeout(this.storeTimer);
    this.lookupTimer = null;
    this.storeTimer = null;
    for (const queue of this.pendingLookups.values()) {
      for (const lookup of queue) lookup.resolve(lookup.texts.map(() => null));
    }
    this.pendingLookups.clear();
    this.pendingStores.clear();
  }

  private pageHideListening = false;

  /** Best effort: send buffered stores when the page goes away */
  private listenForPageHide(): void {
    if (this.pageHideListening) return;
    this.pageHideListening = true;
    try {
      globalThis.addEventListener?.('pagehide', () => {
        void this.flushStores();
      });
    } catch {
      // Not a window context
    }
  }

  private flushLookups(): void {
    this.lookupTimer = null;
    const batches = this.pendingLookups;
    this.pendingLookups = new Map();
    for (const [fp, queue] of batches) {
      void this.sendLookup(fp, queue);
    }
  }

  private async sendLookup(fp: string, queue: PendingLookup[]): Promise<void> {
    const texts = queue.flatMap((lookup) => lookup.texts);
    const hits: Array<CachedTranslation | null> = texts.map(() => null);

    const requests: Promise<void>[] = [];
    for (
      let start = 0;
      start < texts.length;
      start += TM_MAX_TEXTS_PER_MESSAGE
    ) {
      const slice = texts.slice(start, start + TM_MAX_TEXTS_PER_MESSAGE);
      requests.push(
        this.requestWithTimeout({
          type: TM_MESSAGE_TYPES.LOOKUP,
          fp,
          texts: slice,
        }).then((reply) => {
          const entries = (reply as { entries?: unknown[] } | null)?.entries;
          if (!Array.isArray(entries)) return;
          slice.forEach((_, index) => {
            hits[start + index] = hitToCachedTranslation(entries[index]);
          });
        }),
      );
    }
    await Promise.all(requests);

    let offset = 0;
    for (const lookup of queue) {
      lookup.resolve(hits.slice(offset, offset + lookup.texts.length));
      offset += lookup.texts.length;
    }
  }

  private requestWithTimeout(message: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), this.lookupTimeoutMs);
      let request: Promise<unknown>;
      try {
        request = this.send(message);
      } catch {
        request = Promise.resolve(null);
      }
      request.then(
        (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    });
  }
}

/**
 * Bind a client to one fingerprint. Texts rejected by `shouldPersist` are neither
 * looked up nor stored (e.g. texts answered locally without a request).
 */
export function createTranslationMemoryLayer(
  client: TranslationMemoryClient,
  fp: string,
  shouldPersist: (text: string) => boolean = () => true,
): TranslationMemoryLayer {
  return {
    async lookup(texts) {
      const results: Array<CachedTranslation | null> = texts.map(() => null);
      const indexes: number[] = [];
      texts.forEach((text, index) => {
        if (shouldPersist(text)) indexes.push(index);
      });
      if (indexes.length === 0) return results;

      const hits = await client.lookup(
        fp,
        indexes.map((index) => texts[index]),
      );
      indexes.forEach((index, position) => {
        results[index] = hits[position] ?? null;
      });
      return results;
    },
    store(items) {
      client.store(
        fp,
        items.filter((item) => shouldPersist(item.text)),
      );
    },
  };
}

/** Shared client of this document */
export const translationMemoryClient = new TranslationMemoryClient();
