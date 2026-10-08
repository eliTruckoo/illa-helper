/**
 * Persistent cross-tab translation memory (background singleton).
 *
 * L1: in-memory LRU of this background lifetime; L2: IndexedDB (`tm_segments`).
 * Content scripts reach it through batched runtime messages (`tm-lookup`,
 * `tm-store`); the options page uses `tm-stats` / `tm-clear`.
 *
 * - Keys are hashed here (crypto.subtle is missing on http:// pages):
 *   sha256(sha256(fingerprint) + '\n' + normalizedText), 128 bits, base64url.
 * - Stores word pairs only; callers recompute positions for their own text.
 * - 'error' results are never stored; 'empty' answers expire after 3 days.
 * - Incognito tabs use a separate in-memory map and never touch IndexedDB.
 * - Every failure is a miss (fail open): translation must never depend on the cache.
 *
 * Hover definitions use a second instance on `tm_definitions` (messages with
 * `ns: 'definitions'`), with the same TTL, cap, incognito and fail-open rules.
 *
 * Also keeps the word exposure history (`tm_words`, learning layer): how often each
 * word was shown with which translation. Never recorded for incognito tabs.
 */

import { browser } from 'wxt/browser';
import {
  DEFAULT_TM_POLICY,
  TM_MAX_TEXTS_PER_MESSAGE,
  TM_MESSAGE_TYPES,
  TM_EVICTION_FRACTION,
  TM_WORDS_MAX_ENTRIES,
  aggregateWordDeltas,
  deriveSegmentKey,
  estimateEntryBytes,
  hash128,
  isEntryExpired,
  planEviction,
  primaryTranslation,
  resolveTmPolicy,
  sanitizePairs,
  type TmClearScope,
  type TmEntry,
  type TmEntryMeta,
  type TmHit,
  type TmPolicy,
  type TmStats,
  type TmStoreItem,
  type TmWordRecord,
} from '../../core/translation/TranslationMemoryShared';
import { LruCache } from '../../core/translation/SegmentTranslationCache';
import { StorageService } from '../../core/storage/StorageService';
import {
  createDebouncedTask,
  type DebouncedTask,
} from '../../../utils/debounce';
import {
  IndexedDbSegmentBackend,
  IndexedDbWordBackend,
  TM_STORE_DEFINITIONS,
  TranslationMemoryDatabase,
  type TmSegmentBackend,
  type TmWordBackend,
} from './TranslationMemoryDatabase';

/** In-memory entries shared by all regular tabs */
export const TM_L1_MAX_ENTRIES = 2000;
/** In-memory entries for incognito tabs (never persisted) */
export const TM_INCOGNITO_MAX_ENTRIES = 1000;
/** Delay before access times / hit counts of read entries are written back */
const TOUCH_FLUSH_DELAY_MS = 3000;
/** Delay before a sweep after stores */
const SWEEP_DELAY_MS = 5000;
/** A full expiry sweep runs at most this often unless the cap is exceeded */
const FULL_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Fingerprint hashes kept in memory */
const FINGERPRINT_CACHE_SIZE = 64;
/** Policy (settings) is re-read after this long even without a change event */
const POLICY_MAX_AGE_MS = 60 * 1000;
/** Words listed in the stats */
const TOP_WORDS_COUNT = 10;

/** Who sent a message; only `tab.incognito` matters here */
export interface TmRequestContext {
  incognito?: boolean;
}

export interface TmMessageSender {
  tab?: { incognito?: boolean } | null;
}

export interface TranslationMemoryDeps {
  /** null disables persistence (memory only) */
  backend?: TmSegmentBackend | null;
  /** null disables word exposure tracking */
  wordBackend?: TmWordBackend | null;
  /** Memory for `ns: 'definitions'` messages (hover definitions) */
  definitions?: TranslationMemoryService | null;
  loadPolicy?: () => Promise<TmPolicy>;
  now?: () => number;
}

export class TranslationMemoryService {
  private static instance: TranslationMemoryService | null = null;

  private readonly backend: TmSegmentBackend | null;
  private readonly wordBackend: TmWordBackend | null;
  private readonly definitions: TranslationMemoryService | null;
  private readonly loadPolicyFn: () => Promise<TmPolicy>;
  private readonly now: () => number;

  private readonly l1 = new LruCache<TmEntry>(TM_L1_MAX_ENTRIES);
  private readonly incognitoL1 = new LruCache<TmEntry>(
    TM_INCOGNITO_MAX_ENTRIES,
  );
  private readonly fingerprints = new LruCache<Promise<string>>(
    FINGERPRINT_CACHE_SIZE,
  );

  private policy: TmPolicy | null = null;
  private policyLoadedAt = 0;
  private policyPromise: Promise<TmPolicy> | null = null;

  /** Keys whose lastAccess/hits changed and still need to be written */
  private readonly touched = new Set<string>();
  private readonly touchFlush: DebouncedTask<[]>;
  private readonly sweep: DebouncedTask<[]>;
  private readonly wordSweep: DebouncedTask<[]>;
  private lastFullSweep = 0;
  private persistentFailed = false;

  private sessionLookups = 0;
  private sessionHits = 0;

  constructor(deps: TranslationMemoryDeps = {}) {
    const database = TranslationMemoryDatabase.isAvailable()
      ? new TranslationMemoryDatabase()
      : null;
    this.backend =
      deps.backend !== undefined
        ? deps.backend
        : database && new IndexedDbSegmentBackend(database);
    this.wordBackend =
      deps.wordBackend !== undefined
        ? deps.wordBackend
        : database && new IndexedDbWordBackend(database);
    this.definitions = deps.definitions ?? null;
    this.loadPolicyFn = deps.loadPolicy ?? loadPolicyFromSettings;
    this.now = deps.now ?? Date.now;
    this.touchFlush = createDebouncedTask(
      () => this.flushTouched(),
      TOUCH_FLUSH_DELAY_MS,
    );
    this.sweep = createDebouncedTask(() => this.runSweep(), SWEEP_DELAY_MS);
    this.wordSweep = createDebouncedTask(
      () => this.sweepWords(),
      SWEEP_DELAY_MS,
    );
  }

  static getInstance(): TranslationMemoryService {
    if (!TranslationMemoryService.instance) {
      // One connection for segments, words and definitions
      const database = TranslationMemoryDatabase.isAvailable()
        ? new TranslationMemoryDatabase()
        : null;
      const definitions = new TranslationMemoryService({
        backend:
          database &&
          new IndexedDbSegmentBackend(database, TM_STORE_DEFINITIONS),
        wordBackend: null,
      });
      TranslationMemoryService.instance = new TranslationMemoryService({
        backend: database && new IndexedDbSegmentBackend(database),
        wordBackend: database && new IndexedDbWordBackend(database),
        definitions,
      });
    }
    return TranslationMemoryService.instance;
  }

  // ==================== Messages ====================

  /** Whether the message type belongs to this service */
  static handles(type: unknown): boolean {
    return (
      type === TM_MESSAGE_TYPES.LOOKUP ||
      type === TM_MESSAGE_TYPES.STORE ||
      type === TM_MESSAGE_TYPES.STATS ||
      type === TM_MESSAGE_TYPES.CLEAR ||
      type === TM_MESSAGE_TYPES.WORDS_RECORD
    );
  }

  /**
   * Route one runtime message. Never rejects: failures become misses / errors in the reply.
   */
  async handleMessage(message: any, sender?: TmMessageSender): Promise<any> {
    const context: TmRequestContext = {
      incognito: !!sender?.tab?.incognito,
    };
    // Hover definitions live in their own store
    if (
      message?.ns === 'definitions' &&
      (message.type === TM_MESSAGE_TYPES.LOOKUP ||
        message.type === TM_MESSAGE_TYPES.STORE)
    ) {
      if (!this.definitions) {
        return message.type === TM_MESSAGE_TYPES.LOOKUP
          ? { entries: (message.texts || []).map(() => null) }
          : { stored: 0 };
      }
      const { ns: _ns, ...rest } = message;
      return this.definitions.handleMessage(rest, sender);
    }
    try {
      switch (message?.type) {
        case TM_MESSAGE_TYPES.LOOKUP:
          return {
            entries: await this.lookup(message.fp, message.texts, context),
          };
        case TM_MESSAGE_TYPES.STORE:
          return {
            stored: await this.store(message.fp, message.items, context),
          };
        case TM_MESSAGE_TYPES.STATS:
          return await this.getStats();
        case TM_MESSAGE_TYPES.CLEAR:
          await this.clear(message.scope);
          return { success: true };
        case TM_MESSAGE_TYPES.WORDS_RECORD:
          return {
            recorded: await this.recordWords(
              message.srcLang,
              message.tgtLang,
              message.items,
              context,
            ),
          };
        default:
          return undefined;
      }
    } catch (error) {
      console.warn('[TranslationMemory] Message failed:', error);
      if (message?.type === TM_MESSAGE_TYPES.LOOKUP) {
        const count = Array.isArray(message.texts) ? message.texts.length : 0;
        return { entries: new Array(count).fill(null) };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Lookup / store ====================

  async lookup(
    fp: string,
    texts: unknown,
    context: TmRequestContext = {},
  ): Promise<Array<TmHit | null>> {
    const list = Array.isArray(texts)
      ? texts.slice(0, TM_MAX_TEXTS_PER_MESSAGE)
      : [];
    const results: Array<TmHit | null> = list.map(() => null);
    if (list.length === 0 || typeof fp !== 'string' || !fp) return results;

    const policy = await this.getPolicy();
    if (!policy.enabled) return results;

    this.sessionLookups += list.length;
    const fpHash = await this.fingerprintHash(fp);
    const keys = await Promise.all(
      list.map((text) =>
        typeof text === 'string' ? deriveSegmentKey(fpHash, text) : '',
      ),
    );
    const now = this.now();
    const memory = context.incognito ? this.incognitoL1 : this.l1;

    const missing: number[] = [];
    keys.forEach((key, index) => {
      if (!key) return;
      const entry = memory.get(key);
      if (entry && !isEntryExpired(entry, now, policy)) {
        results[index] = this.hit(entry, now, !context.incognito);
      } else {
        if (entry) memory.delete(key);
        missing.push(index);
      }
    });

    if (context.incognito || missing.length === 0 || !this.backend) {
      return results;
    }

    let rows: Array<TmEntry | undefined> = [];
    try {
      rows = await this.backend.getMany(missing.map((index) => keys[index]));
      this.persistentFailed = false;
    } catch (error) {
      this.reportPersistentFailure(error);
      return results;
    }

    const expired: string[] = [];
    missing.forEach((index, position) => {
      const row = rows[position];
      if (!row || !Array.isArray(row.pairs)) return;
      if (isEntryExpired(row, now, policy)) {
        expired.push(row.key);
        return;
      }
      this.l1.set(row.key, row);
      results[index] = this.hit(row, now, true);
    });

    if (expired.length > 0) {
      this.backend.deleteMany(expired).catch(() => undefined);
    }
    return results;
  }

  async store(
    fp: string,
    items: unknown,
    context: TmRequestContext = {},
  ): Promise<number> {
    const list = Array.isArray(items)
      ? (items.slice(0, TM_MAX_TEXTS_PER_MESSAGE) as TmStoreItem[])
      : [];
    if (list.length === 0 || typeof fp !== 'string' || !fp) return 0;

    const policy = await this.getPolicy();
    if (!policy.enabled) return 0;

    const fpHash = await this.fingerprintHash(fp);
    const now = this.now();
    const entries: TmEntry[] = [];

    for (const item of list) {
      if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
      // Only successful answers are stored; anything else is not trusted
      if (item.status !== 'ok' && item.status !== 'empty') continue;
      const pairs = item.status === 'ok' ? sanitizePairs(item.pairs) : [];
      entries.push({
        key: await deriveSegmentKey(fpHash, item.text),
        fp: fpHash,
        status: pairs.length > 0 ? 'ok' : 'empty',
        pairs,
        createdAt: now,
        lastAccess: now,
        hits: 0,
      });
    }

    const memory = context.incognito ? this.incognitoL1 : this.l1;
    for (const entry of entries) memory.set(entry.key, entry);

    if (context.incognito || !this.backend || entries.length === 0) {
      return entries.length;
    }

    try {
      await this.backend.putMany(entries);
      this.sweep.schedule();
    } catch (error) {
      this.reportPersistentFailure(error);
    }
    return entries.length;
  }

  private hit(entry: TmEntry, now: number, persist: boolean): TmHit {
    this.sessionHits++;
    entry.lastAccess = now;
    entry.hits = (entry.hits || 0) + 1;
    if (persist && this.backend) {
      this.touched.add(entry.key);
      this.touchFlush.schedule();
    }
    return {
      status: entry.status,
      pairs: entry.pairs.map(([original, translation]) => [
        original,
        translation,
      ]),
    };
  }

  /** Write back access times and hit counts of entries read since the last flush */
  async flushTouched(): Promise<void> {
    if (!this.backend || this.touched.size === 0) return;
    const entries: TmEntry[] = [];
    for (const key of this.touched) {
      const entry = this.l1.get(key);
      if (entry) entries.push(entry);
    }
    this.touched.clear();
    try {
      await this.backend.putMany(entries);
    } catch (error) {
      this.reportPersistentFailure(error);
    }
  }

  // ==================== Retention ====================

  /**
   * Delete expired entries and, above the cap, the least recently used ones.
   * Cheap when nothing is due: one count() unless a full sweep is scheduled.
   */
  async runSweep(force: boolean = false): Promise<number> {
    if (!this.backend) return 0;
    try {
      const policy = await this.getPolicy();
      const now = this.now();
      const count = await this.backend.count();
      const due =
        force ||
        count > policy.maxEntries ||
        now - this.lastFullSweep > FULL_SWEEP_INTERVAL_MS;
      if (!due) return 0;

      const meta: TmEntryMeta[] = [];
      await this.backend.scan((entry) => {
        meta.push({
          key: entry.key,
          status: entry.status,
          createdAt: entry.createdAt,
          lastAccess: entry.lastAccess,
        });
      });
      const doomed = planEviction(meta, now, policy);
      if (doomed.length > 0) {
        await this.backend.deleteMany(doomed);
        for (const key of doomed) {
          this.l1.delete(key);
          this.touched.delete(key);
        }
      }
      this.lastFullSweep = now;
      return doomed.length;
    } catch (error) {
      this.reportPersistentFailure(error);
      return 0;
    }
  }

  // ==================== Stats / clear ====================

  async getStats(): Promise<TmStats> {
    const policy = await this.getPolicy();
    const stats: TmStats = {
      enabled: policy.enabled,
      entries: 0,
      okEntries: 0,
      emptyEntries: 0,
      approxBytes: 0,
      hits: 0,
      memoryEntries: this.l1.size,
      sessionLookups: this.sessionLookups,
      sessionHits: this.sessionHits,
      definitions: 0,
      words: 0,
      wordExposures: 0,
      topWords: [],
      persistent: !!this.backend && !this.persistentFailed,
    };

    if (this.backend) {
      // Pending hit counts first, so the numbers include them
      await this.flushTouched();
      try {
        await this.backend.scan((entry) => {
          stats.entries++;
          if (entry.status === 'empty') stats.emptyEntries++;
          else stats.okEntries++;
          stats.hits += entry.hits || 0;
          stats.approxBytes += estimateEntryBytes(entry);
        });
        stats.persistent = true;
      } catch (error) {
        this.reportPersistentFailure(error);
        stats.persistent = false;
      }
    }

    if (this.definitions?.backend) {
      try {
        stats.definitions = await this.definitions.backend.count();
      } catch (error) {
        this.reportPersistentFailure(error);
      }
    }

    if (this.wordBackend) {
      const top: TmWordRecord[] = [];
      try {
        await this.wordBackend.scan((record) => {
          stats.words++;
          stats.wordExposures += record.exposures || 0;
          top.push(record);
          if (top.length > TOP_WORDS_COUNT * 4) {
            top.sort((a, b) => b.exposures - a.exposures);
            top.length = TOP_WORDS_COUNT;
          }
        });
        top.sort((a, b) => b.exposures - a.exposures);
        stats.topWords = top.slice(0, TOP_WORDS_COUNT).map((record) => ({
          surface: record.surface,
          translation: primaryTranslation(record),
          exposures: record.exposures,
        }));
      } catch (error) {
        this.reportPersistentFailure(error);
      }
    }
    return stats;
  }

  async clear(scope: TmClearScope = 'segments'): Promise<void> {
    if (scope === 'segments' || scope === 'all') {
      this.l1.clear();
      this.incognitoL1.clear();
      this.touched.clear();
      this.touchFlush.cancel();
      this.sessionLookups = 0;
      this.sessionHits = 0;
      await this.backend?.clear();
      await this.definitions?.clear('segments');
    }
    if (scope === 'words' || scope === 'all') {
      await this.wordBackend?.clear();
    }
  }

  // ==================== Word exposure ====================

  /**
   * Add exposures of applied replacements (already aggregated per page by the content side).
   * Skipped for incognito tabs and when the cache is disabled.
   */
  async recordWords(
    srcLang: unknown,
    tgtLang: unknown,
    items: unknown,
    context: TmRequestContext = {},
  ): Promise<number> {
    if (context.incognito || !this.wordBackend) return 0;
    if (typeof srcLang !== 'string' || typeof tgtLang !== 'string') return 0;

    const policy = await this.getPolicy();
    if (!policy.enabled) return 0;

    const aggregated = aggregateWordDeltas(srcLang, tgtLang, items);
    if (aggregated.size === 0) return 0;

    try {
      await this.wordBackend.applyDeltas(
        [...aggregated].map(([id, delta]) => ({ id, srcLang, tgtLang, delta })),
        this.now(),
      );
      this.wordSweep.schedule();
    } catch (error) {
      this.reportPersistentFailure(error);
      return 0;
    }
    return aggregated.size;
  }

  /** Keep the word history below TM_WORDS_MAX_ENTRIES (least recently seen go first) */
  async sweepWords(): Promise<number> {
    if (!this.wordBackend) return 0;
    try {
      const count = await this.wordBackend.count();
      if (count <= TM_WORDS_MAX_ENTRIES) return 0;
      const target =
        TM_WORDS_MAX_ENTRIES -
        Math.ceil(TM_WORDS_MAX_ENTRIES * TM_EVICTION_FRACTION);
      await this.wordBackend.deleteOldest(count - target);
      return count - target;
    } catch (error) {
      this.reportPersistentFailure(error);
      return 0;
    }
  }

  // ==================== Settings ====================

  /** Drop the cached policy (settings changed) */
  invalidatePolicy(): void {
    this.policy = null;
    this.policyPromise = null;
    this.definitions?.invalidatePolicy();
  }

  async getPolicy(): Promise<TmPolicy> {
    const now = this.now();
    if (this.policy && now - this.policyLoadedAt < POLICY_MAX_AGE_MS) {
      return this.policy;
    }
    if (!this.policyPromise) {
      const loading = this.loadPolicyFn()
        .catch(() => DEFAULT_TM_POLICY)
        .then((policy) => {
          if (this.policyPromise === loading) {
            this.policy = policy;
            this.policyLoadedAt = this.now();
            this.policyPromise = null;
          }
          return policy;
        });
      this.policyPromise = loading;
    }
    return this.policyPromise;
  }

  /**
   * Re-read the policy when the user settings change (call once at background start).
   */
  registerListeners(): void {
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes && 'user_settings' in changes) {
          this.invalidatePolicy();
        }
      });
    } catch {
      // Policy still refreshes after POLICY_MAX_AGE_MS
    }
  }

  // ==================== Internals ====================

  private fingerprintHash(fp: string): Promise<string> {
    let pending = this.fingerprints.get(fp);
    if (!pending) {
      pending = hash128(fp);
      this.fingerprints.set(fp, pending);
      pending.catch(() => this.fingerprints.delete(fp));
    }
    return pending;
  }

  private reportPersistentFailure(error: unknown): void {
    if (!this.persistentFailed) {
      console.warn('[TranslationMemory] IndexedDB unavailable:', error);
    }
    this.persistentFailed = true;
  }
}

/**
 * Read `translationCache` from the stored user settings.
 */
async function loadPolicyFromSettings(): Promise<TmPolicy> {
  const settings = await StorageService.getInstance().getUserSettings();
  return resolveTmPolicy(settings.translationCache);
}
