/**
 * Persistent translation memory: wire format, fingerprints, keys and retention rules.
 *
 * Shared by the background TranslationMemoryService (IndexedDB) and the content-side
 * TranslationMemoryClient. Free of browser APIs and `@/` imports so it can be tested
 * in Node; hashing uses `crypto.subtle`, which only runs in the background
 * (content scripts on http:// pages may lack it).
 */

import { normalizeSegmentText } from './SegmentTranslationCache';

/** Bump to invalidate every stored entry (format or semantic change) */
export const TM_SCHEMA_VERSION = 1;

/** Runtime message types handled by the background */
export const TM_MESSAGE_TYPES = {
  LOOKUP: 'tm-lookup',
  STORE: 'tm-store',
  STATS: 'tm-stats',
  CLEAR: 'tm-clear',
  WORDS_RECORD: 'tm-words-record',
} as const;

/** Defaults of `UserSettings.translationCache` */
export const TM_DEFAULT_MAX_ENTRIES = 20000;
export const TM_DEFAULT_TTL_DAYS = 30;
/** 'empty' answers expire sooner: they may be a model quirk */
export const TM_EMPTY_TTL_DAYS = 3;
/** Share of the cap removed (oldest by last access) once the cap is exceeded */
export const TM_EVICTION_FRACTION = 0.1;
/** Bounds accepted for user-provided settings */
export const TM_MIN_MAX_ENTRIES = 1000;
export const TM_MAX_MAX_ENTRIES = 200000;
export const TM_MIN_TTL_DAYS = 1;
export const TM_MAX_TTL_DAYS = 365;
/** Texts per lookup/store message */
export const TM_MAX_TEXTS_PER_MESSAGE = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TmStatus = 'ok' | 'empty';

/** One stored pair: [original, translation] */
export type TmPair = [string, string];

/** Value of a lookup hit as sent over the wire */
export interface TmHit {
  status: TmStatus;
  pairs: TmPair[];
}

/** Stored record (`tm_segments`) */
export interface TmEntry extends TmHit {
  key: string;
  /** Hash of the fingerprint (index; lets entries of one configuration be found) */
  fp: string;
  createdAt: number;
  lastAccess: number;
  hits: number;
}

export interface TmStoreItem extends TmHit {
  text: string;
}

/** Which memory a lookup/store addresses (default: translated segments) */
export type TmNamespace = 'segments' | 'definitions';

export interface TmLookupMessage {
  type: typeof TM_MESSAGE_TYPES.LOOKUP;
  ns?: TmNamespace;
  /** Canonical fingerprint source (see buildWordFingerprintSource) */
  fp: string;
  texts: string[];
}

export interface TmLookupResponse {
  /** One entry per text, null = miss */
  entries: Array<TmHit | null>;
}

export interface TmStoreMessage {
  type: typeof TM_MESSAGE_TYPES.STORE;
  ns?: TmNamespace;
  fp: string;
  items: TmStoreItem[];
}

export interface TmStatsMessage {
  type: typeof TM_MESSAGE_TYPES.STATS;
}

export type TmClearScope = 'segments' | 'words' | 'all';

export interface TmClearMessage {
  type: typeof TM_MESSAGE_TYPES.CLEAR;
  scope?: TmClearScope;
}

export interface TmStats {
  enabled: boolean;
  /** Persistent entries (IndexedDB) */
  entries: number;
  okEntries: number;
  emptyEntries: number;
  /** Rough size of the stored records in bytes */
  approxBytes: number;
  /** Lookup hits recorded on the stored entries */
  hits: number;
  /** In-memory entries of this background lifetime */
  memoryEntries: number;
  /** Lookups / hits since the background (service worker) started */
  sessionLookups: number;
  sessionHits: number;
  /** Persistent hover definitions */
  definitions: number;
  /** Word exposure tracking: distinct words and total exposures */
  words: number;
  wordExposures: number;
  /** Most frequently shown words */
  topWords: Array<{ surface: string; translation: string; exposures: number }>;
  /** Whether IndexedDB could be opened */
  persistent: boolean;
}

// ==================== Word exposure (learning layer) ====================

/** Distinct words kept; the least recently seen are evicted above it */
export const TM_WORDS_MAX_ENTRIES = 50000;
/** Translations remembered per word (most frequent first) */
export const TM_WORD_MAX_TRANSLATIONS = 8;
/** Words per `tm-words-record` message */
export const TM_MAX_WORDS_PER_MESSAGE = 500;
const MAX_SURFACE_LENGTH = 80;

/** One applied replacement shown to the user, aggregated on the content side */
export interface TmWordDelta {
  surface: string;
  translation: string;
  count: number;
}

export interface TmWordsRecordMessage {
  type: typeof TM_MESSAGE_TYPES.WORDS_RECORD;
  srcLang: string;
  tgtLang: string;
  items: TmWordDelta[];
}

/** Stored record (`tm_words`) */
export interface TmWordRecord {
  /** `${srcLang}|${tgtLang}|${surface.toLowerCase()}` */
  id: string;
  srcLang: string;
  tgtLang: string;
  surface: string;
  translations: Record<string, number>;
  exposures: number;
  firstSeen: number;
  lastSeen: number;
}

export function normalizeLanguageTag(tag: string | undefined): string {
  const base = (tag || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) ? base : 'und';
}

export function normalizeWordSurface(surface: string): string {
  return normalizeSegmentText(surface).toLowerCase();
}

export function buildWordId(
  srcLang: string,
  tgtLang: string,
  surface: string,
): string {
  return `${normalizeLanguageTag(srcLang)}|${normalizeLanguageTag(tgtLang)}|${normalizeWordSurface(surface)}`;
}

/**
 * Validate and merge deltas of one message by word id (the background never trusts payloads).
 */
export function aggregateWordDeltas(
  srcLang: string,
  tgtLang: string,
  items: unknown,
): Map<
  string,
  { surface: string; translations: Map<string, number>; count: number }
> {
  const result = new Map<
    string,
    { surface: string; translations: Map<string, number>; count: number }
  >();
  if (!Array.isArray(items)) return result;

  for (const item of items.slice(0, TM_MAX_WORDS_PER_MESSAGE)) {
    const surface =
      typeof item?.surface === 'string'
        ? normalizeWordSurface(item.surface)
        : '';
    const translation =
      typeof item?.translation === 'string'
        ? item.translation.trim().slice(0, MAX_SURFACE_LENGTH)
        : '';
    const count = Math.min(
      1000,
      Math.max(1, Math.floor(Number(item?.count) || 1)),
    );
    if (!surface || surface.length > MAX_SURFACE_LENGTH || !translation) {
      continue;
    }

    const id = buildWordId(srcLang, tgtLang, surface);
    const entry = result.get(id) ?? {
      surface,
      translations: new Map<string, number>(),
      count: 0,
    };
    entry.count += count;
    entry.translations.set(
      translation,
      (entry.translations.get(translation) ?? 0) + count,
    );
    result.set(id, entry);
  }
  return result;
}

/**
 * Apply one aggregated delta to a stored word record (or create it).
 */
export function mergeWordRecord(
  existing: TmWordRecord | undefined,
  id: string,
  srcLang: string,
  tgtLang: string,
  delta: { surface: string; translations: Map<string, number>; count: number },
  now: number,
): TmWordRecord {
  const translations: Record<string, number> = {
    ...(existing?.translations ?? {}),
  };
  for (const [translation, count] of delta.translations) {
    translations[translation] = (translations[translation] ?? 0) + count;
  }
  const kept = Object.entries(translations)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TM_WORD_MAX_TRANSLATIONS);

  return {
    id,
    srcLang: normalizeLanguageTag(srcLang),
    tgtLang: normalizeLanguageTag(tgtLang),
    surface: delta.surface,
    translations: Object.fromEntries(kept),
    exposures: (existing?.exposures ?? 0) + delta.count,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };
}

/** Most frequent translation of a word record */
export function primaryTranslation(record: TmWordRecord): string {
  let best = '';
  let bestCount = -1;
  for (const [translation, count] of Object.entries(record.translations)) {
    if (count > bestCount) {
      best = translation;
      bestCount = count;
    }
  }
  return best;
}

export interface TmPolicy {
  enabled: boolean;
  maxEntries: number;
  ttlDays: number;
}

export const DEFAULT_TM_POLICY: TmPolicy = {
  enabled: true,
  maxEntries: TM_DEFAULT_MAX_ENTRIES,
  ttlDays: TM_DEFAULT_TTL_DAYS,
};

/**
 * Clamp user settings to sane bounds; missing values fall back to the defaults.
 */
export function resolveTmPolicy(
  settings: Partial<TmPolicy> | null | undefined,
): TmPolicy {
  const clamp = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;

  return {
    enabled: settings?.enabled !== false,
    maxEntries: clamp(
      settings?.maxEntries,
      TM_MIN_MAX_ENTRIES,
      TM_MAX_MAX_ENTRIES,
      TM_DEFAULT_MAX_ENTRIES,
    ),
    ttlDays: clamp(
      settings?.ttlDays,
      TM_MIN_TTL_DAYS,
      TM_MAX_TTL_DAYS,
      TM_DEFAULT_TTL_DAYS,
    ),
  };
}

// ==================== Fingerprints ====================

/**
 * JSON with sorted object keys and without undefined members, so equal inputs
 * always serialize identically (property order of settings objects varies).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : sortForJson(item)));
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) {
        sorted[key] = sortForJson(member);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Endpoint without query string or fragment (they may carry credentials).
 */
export function endpointIdentity(endpoint: string | undefined): string {
  const raw = (endpoint || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

/** Inputs that change the word-mode model answer for the same text */
export interface WordFingerprintParts {
  protocolFamily?: string;
  endpoint?: string;
  model: string;
  temperature?: number;
  customParams?: string;
  /** null when the thinking parameter is not sent */
  thinking?: boolean | null;
  /** The system prompt actually sent for single-segment requests */
  systemPrompt: string;
  /** The system prompt actually sent for batch requests */
  batchSystemPrompt: string;
  /** Version of the user-message format and answer parser */
  promptVersion: string;
  /** Rendered sample of the user message(s), so format edits invalidate too */
  userPromptFormat?: string;
  targetLanguage: string;
  userLevel: number | string;
  replacementRate: number;
}

/**
 * Canonical fingerprint source of the word mode.
 *
 * Built from the same inputs as the in-page cache key (buildTranslationCacheKey)
 * plus the actual prompt strings, so prompt edits invalidate stored answers.
 * Single and batch requests answer with the same pairs, so both prompts are part
 * of one fingerprint and either path can reuse the other's results.
 */
export function buildWordFingerprintSource(
  parts: WordFingerprintParts,
): string {
  return canonicalJson({
    schema: TM_SCHEMA_VERSION,
    kind: 'word',
    protocolFamily: parts.protocolFamily ?? '',
    endpoint: endpointIdentity(parts.endpoint),
    model: parts.model,
    temperature: parts.temperature ?? null,
    customParams: parts.customParams?.trim() ?? '',
    thinking: parts.thinking ?? null,
    systemPrompt: parts.systemPrompt,
    batchSystemPrompt: parts.batchSystemPrompt,
    promptVersion: parts.promptVersion,
    userPromptFormat: parts.userPromptFormat ?? '',
    targetLanguage: parts.targetLanguage,
    userLevel: parts.userLevel,
    replacementRate: parts.replacementRate,
  });
}

/** Inputs that change the paragraph-mode answer for the same text */
export interface ParagraphFingerprintParts {
  protocolFamily?: string;
  endpoint?: string;
  model: string;
  temperature?: number;
  customParams?: string;
  thinking?: boolean | null;
  /** Prompt template (the text is inserted into it) */
  promptTemplate: string;
  targetLanguage: string;
}

export function buildParagraphFingerprintSource(
  parts: ParagraphFingerprintParts,
): string {
  return canonicalJson({
    schema: TM_SCHEMA_VERSION,
    kind: 'paragraph',
    protocolFamily: parts.protocolFamily ?? '',
    endpoint: endpointIdentity(parts.endpoint),
    model: parts.model,
    temperature: parts.temperature ?? null,
    customParams: parts.customParams?.trim() ?? '',
    thinking: parts.thinking ?? null,
    promptTemplate: parts.promptTemplate,
    targetLanguage: parts.targetLanguage.toLowerCase(),
  });
}

/** Inputs that change a hover definition for the same word */
export interface DefinitionFingerprintParts {
  protocolFamily?: string;
  endpoint?: string;
  model: string;
  temperature?: number;
  customParams?: string;
  maxTokens?: number;
  /** The definition system prompt actually sent */
  systemPrompt: string;
}

export function buildDefinitionFingerprintSource(
  parts: DefinitionFingerprintParts,
): string {
  return canonicalJson({
    schema: TM_SCHEMA_VERSION,
    kind: 'definition',
    protocolFamily: parts.protocolFamily ?? '',
    endpoint: endpointIdentity(parts.endpoint),
    model: parts.model,
    temperature: parts.temperature ?? null,
    customParams: parts.customParams?.trim() ?? '',
    maxTokens: parts.maxTokens ?? null,
    systemPrompt: parts.systemPrompt,
  });
}

// ==================== Keys ====================

type SubtleDigest = (
  algorithm: string,
  data: ArrayBuffer | Uint8Array,
) => Promise<ArrayBuffer>;

function getDigest(): SubtleDigest {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('crypto.subtle is not available');
  }
  return subtle.digest.bind(subtle);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * sha256 of a string, truncated to 128 bits, base64url (22 characters).
 */
export async function hash128(input: string): Promise<string> {
  const digest = await getDigest()('SHA-256', new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest).slice(0, 16));
}

/**
 * Storage key of one segment: sha256(fingerprintHash + '\n' + normalizedText).
 */
export function deriveSegmentKey(
  fpHash: string,
  text: string,
): Promise<string> {
  return hash128(`${fpHash}\n${normalizeSegmentText(text)}`);
}

// ==================== Retention ====================

export function ttlMsFor(status: TmStatus, policy: TmPolicy): number {
  const days =
    status === 'empty'
      ? Math.min(TM_EMPTY_TTL_DAYS, policy.ttlDays)
      : policy.ttlDays;
  return days * DAY_MS;
}

/** Entries expire relative to their creation, so 'empty' answers get retried */
export function isEntryExpired(
  entry: Pick<TmEntry, 'status' | 'createdAt'>,
  now: number,
  policy: TmPolicy,
): boolean {
  return now - entry.createdAt > ttlMsFor(entry.status, policy);
}

export type TmEntryMeta = Pick<
  TmEntry,
  'key' | 'status' | 'createdAt' | 'lastAccess'
>;

/**
 * Keys to delete in one sweep: every expired entry, then — if the cap is still
 * exceeded — the least recently used entries down to (cap - 10 % of cap), so
 * sweeps do not run after every single store.
 */
export function planEviction(
  entries: TmEntryMeta[],
  now: number,
  policy: TmPolicy,
): string[] {
  const doomed: string[] = [];
  const alive: TmEntryMeta[] = [];
  for (const entry of entries) {
    if (isEntryExpired(entry, now, policy)) {
      doomed.push(entry.key);
    } else {
      alive.push(entry);
    }
  }

  if (alive.length > policy.maxEntries) {
    const target = Math.max(
      0,
      policy.maxEntries - Math.ceil(policy.maxEntries * TM_EVICTION_FRACTION),
    );
    alive.sort((a, b) => a.lastAccess - b.lastAccess);
    for (let index = 0; index < alive.length - target; index++) {
      doomed.push(alive[index].key);
    }
  }

  return doomed;
}

// ==================== Validation ====================

/**
 * Keep only well-formed pairs (the background never trusts message payloads).
 */
export function sanitizePairs(pairs: unknown): TmPair[] {
  if (!Array.isArray(pairs)) return [];
  const result: TmPair[] = [];
  for (const pair of pairs) {
    if (
      Array.isArray(pair) &&
      typeof pair[0] === 'string' &&
      typeof pair[1] === 'string' &&
      pair[0] &&
      pair[1]
    ) {
      result.push([pair[0], pair[1]]);
    }
  }
  return result;
}

/**
 * Rough record size in bytes (UTF-16 strings plus fixed overhead)
 */
export function estimateEntryBytes(entry: Pick<TmEntry, 'pairs'>): number {
  let chars = 0;
  for (const [original, translation] of entry.pairs) {
    chars += original.length + translation.length + 8;
  }
  return chars * 2 + 160;
}
