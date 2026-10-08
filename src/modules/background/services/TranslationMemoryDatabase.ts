/**
 * IndexedDB access for the persistent translation memory.
 *
 * Opened lazily and only from the background (extension origin). The MV3 service
 * worker may be stopped at any time; the next call simply opens the database again.
 * A connection closed by the browser (or by a version change) is dropped and
 * reopened on the next call.
 */

import type { TmEntry } from '../../core/translation/TranslationMemoryShared';

export const TM_DB_NAME = 'illa-translation-memory';
export const TM_DB_VERSION = 1;

export const TM_STORE_SEGMENTS = 'tm_segments';

/** Store definitions; upgrades create whatever is missing */
const STORE_DEFINITIONS: Array<{
  name: string;
  keyPath: string;
  indexes: Array<{ name: string; keyPath: string }>;
}> = [
  {
    name: TM_STORE_SEGMENTS,
    keyPath: 'key',
    indexes: [
      { name: 'lastAccess', keyPath: 'lastAccess' },
      { name: 'fp', keyPath: 'fp' },
    ],
  },
];

export class TranslationMemoryDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** Whether IndexedDB exists in this context at all */
  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!TranslationMemoryDatabase.isAvailable()) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(TM_DB_NAME, TM_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const tx = request.transaction;
        for (const definition of STORE_DEFINITIONS) {
          const store = db.objectStoreNames.contains(definition.name)
            ? tx!.objectStore(definition.name)
            : db.createObjectStore(definition.name, {
                keyPath: definition.keyPath,
              });
          for (const index of definition.indexes) {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath);
            }
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => this.reset(opening);
        db.onversionchange = () => {
          db.close();
          this.reset(opening);
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Translation memory database is blocked'));
    });

    this.dbPromise = opening;
    // A failed open is retried on the next call
    opening.catch(() => this.reset(opening));
    return opening;
  }

  private reset(expected?: Promise<IDBDatabase>): void {
    if (!expected || this.dbPromise === expected) {
      this.dbPromise = null;
    }
  }

  /**
   * Run one transaction on one store. `work` issues requests synchronously and
   * returns a reader that is called once the transaction completed.
   */
  async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => () => T,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(storeName, mode);
      } catch (error) {
        // Connection is closing (e.g. after a browser-initiated close): reopen next time
        this.reset();
        reject(error);
        return;
      }
      let read: () => T;
      try {
        read = work(tx.objectStore(storeName));
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Already finished
        }
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(read());
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    });
  }

  count(storeName: string): Promise<number> {
    return this.withStore(storeName, 'readonly', (store) => {
      let total = 0;
      const request = store.count();
      request.onsuccess = () => {
        total = request.result;
      };
      return () => total;
    });
  }

  async clear(storeName: string): Promise<void> {
    await this.withStore(storeName, 'readwrite', (store) => {
      store.clear();
      return () => undefined;
    });
  }

  /**
   * Visit every record of a store with a read-only cursor.
   */
  async scan<V>(storeName: string, visit: (value: V) => void): Promise<void> {
    await this.withStore(storeName, 'readonly', (store) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        visit(cursor.value as V);
        cursor.continue();
      };
      return () => undefined;
    });
  }

  /** Close the connection (tests, shutdown) */
  async close(): Promise<void> {
    const pending = this.dbPromise;
    this.dbPromise = null;
    if (!pending) return;
    try {
      (await pending).close();
    } catch {
      // Never opened
    }
  }
}

/**
 * Storage operations of the segment store, behind an interface so the service
 * logic can be tested without IndexedDB.
 */
export interface TmSegmentBackend {
  getMany(keys: string[]): Promise<Array<TmEntry | undefined>>;
  putMany(entries: TmEntry[]): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  count(): Promise<number>;
  scan(visit: (entry: TmEntry) => void): Promise<void>;
  clear(): Promise<void>;
}

export class IndexedDbSegmentBackend implements TmSegmentBackend {
  constructor(private readonly db: TranslationMemoryDatabase) {}

  getMany(keys: string[]): Promise<Array<TmEntry | undefined>> {
    return this.db.withStore(TM_STORE_SEGMENTS, 'readonly', (store) => {
      const results: Array<TmEntry | undefined> = new Array(keys.length);
      keys.forEach((key, index) => {
        const request = store.get(key);
        request.onsuccess = () => {
          results[index] = request.result as TmEntry | undefined;
        };
      });
      return () => results;
    });
  }

  putMany(entries: TmEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return this.db.withStore(TM_STORE_SEGMENTS, 'readwrite', (store) => {
      for (const entry of entries) store.put(entry);
      return () => undefined;
    });
  }

  deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return Promise.resolve();
    return this.db.withStore(TM_STORE_SEGMENTS, 'readwrite', (store) => {
      for (const key of keys) store.delete(key);
      return () => undefined;
    });
  }

  count(): Promise<number> {
    return this.db.count(TM_STORE_SEGMENTS);
  }

  scan(visit: (entry: TmEntry) => void): Promise<void> {
    return this.db.scan<TmEntry>(TM_STORE_SEGMENTS, visit);
  }

  clear(): Promise<void> {
    return this.db.clear(TM_STORE_SEGMENTS);
  }
}
