/**
 * Lookup cache for hover lookups (phonetics, AI definitions).
 *
 * - Positive and negative (failure) results are cached with their own TTL, so
 *   a word that is not in the dictionary or whose lookup just failed is not
 *   re-requested on every hover.
 * - Concurrent lookups of the same key share one in-flight promise.
 * - The cache is bounded (oldest entry evicted first).
 */

/** Outcome produced by a loader; ttlMs <= 0 means "do not cache". */
export type LookupOutcome<T> =
  | { ok: true; data: T; ttlMs: number }
  | { ok: false; error: string; ttlMs: number };

/** Result handed to callers. */
export type LookupResult<T> =
  | { ok: true; data: T; cached: boolean }
  | { ok: false; error: string; cached: boolean };

type LookupEntry<T> =
  | { ok: true; data: T; expiresAt: number }
  | { ok: false; error: string; expiresAt: number };

export interface LookupCacheOptions {
  maxEntries: number;
  /** Clock override for tests */
  now?: () => number;
}

export class LookupCache<T> {
  private readonly entries = new Map<string, LookupEntry<T>>();
  private readonly inflight = new Map<string, Promise<LookupResult<T>>>();
  private readonly now: () => number;
  // Bumped by clear(): results of lookups started before are not stored
  private generation = 0;

  constructor(private readonly options: LookupCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Return a cached result, join an in-flight lookup, or run `load` once.
   */
  resolve(
    key: string,
    load: () => Promise<LookupOutcome<T>>,
  ): Promise<LookupResult<T>> {
    const cached = this.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const generation = this.generation;
    const promise = load()
      .catch(
        (error): LookupOutcome<T> => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          ttlMs: 0,
        }),
      )
      .then((outcome): LookupResult<T> => {
        if (generation === this.generation && outcome.ttlMs > 0) {
          this.store(key, outcome);
        }
        return outcome.ok
          ? { ok: true, data: outcome.data, cached: false }
          : { ok: false, error: outcome.error, cached: false };
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Get a non-expired cached result.
   */
  get(key: string): LookupResult<T> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return entry.ok
      ? { ok: true, data: entry.data, cached: true }
      : { ok: false, error: entry.error, cached: true };
  }

  /**
   * Drop everything, including the results of lookups still in flight.
   */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
    this.generation++;
  }

  /**
   * Drop cached failures only (e.g. after the configuration was fixed).
   */
  clearFailures(): void {
    for (const [key, entry] of this.entries) {
      if (!entry.ok) {
        this.entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private store(key: string, outcome: LookupOutcome<T>): void {
    const expiresAt = this.now() + outcome.ttlMs;
    // Re-insert so the entry counts as the newest one
    this.entries.delete(key);
    this.entries.set(
      key,
      outcome.ok
        ? { ok: true, data: outcome.data, expiresAt }
        : { ok: false, error: outcome.error, expiresAt },
    );

    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
