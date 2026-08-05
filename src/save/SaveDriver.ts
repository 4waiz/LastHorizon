/**
 * Where saves physically live.
 *
 * Abstracted for two reasons: it lets `SaveService` be tested exhaustively
 * without an IndexedDB shim, and it keeps the failure injection honest — a
 * driver that throws on write is how the "failed transaction recovery" path
 * gets exercised for real rather than mocked at the wrong layer.
 */

export interface SaveDriver {
  get(key: string): Promise<string | null>;
  put(key: string, json: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** In-memory driver. Tests, and a fallback when IndexedDB is unavailable. */
export class MemoryDriver implements SaveDriver {
  private readonly store = new Map<string, string>();

  /** Set to make the next write throw, for recovery tests. */
  failNextWrite = false;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, json: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('simulated write failure');
    }
    this.store.set(key, json);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.store.keys()].sort();
  }

  /** Test helper: corrupt a record without going through the service. */
  poke(key: string, json: string): void {
    this.store.set(key, json);
  }
}

const DB_NAME = 'lasthorizon';
const DB_VERSION = 1;
const STORE = 'saves';

/**
 * IndexedDB driver.
 *
 * Structured save data belongs here rather than in localStorage: localStorage
 * is synchronous (so a large write janks the frame), size-capped at a few MB,
 * and string-only. Tiny preferences stay in localStorage, where its
 * synchronous simplicity is an advantage.
 */
export class IndexedDbDriver implements SaveDriver {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;

    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        this.db = req.result;
        // A version change from another tab must not leave a dead handle.
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.opening = null;
        };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return this.opening;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      // Resolve on the *transaction*, not the request: a request can succeed
      // and the transaction still abort, which would lose the write silently.
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    });
  }

  async get(key: string): Promise<string | null> {
    const v = await this.tx<string | undefined>('readonly', (s) => s.get(key) as IDBRequest<string | undefined>);
    return v ?? null;
  }

  async put(key: string, json: string): Promise<void> {
    await this.tx('readwrite', (s) => s.put(json, key) as IDBRequest<IDBValidKey>);
  }

  async delete(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key) as unknown as IDBRequest<undefined>);
  }

  async keys(): Promise<string[]> {
    const all = await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    return all.map(String).sort();
  }
}

/** IndexedDB where available, memory otherwise. Never throws on construction. */
export function createSaveDriver(): SaveDriver {
  if (IndexedDbDriver.isAvailable()) {
    try {
      return new IndexedDbDriver();
    } catch {
      // Private-browsing modes can expose the API and refuse to open it.
    }
  }
  console.warn('[LastHorizon] IndexedDB unavailable; saves will not persist this session');
  return new MemoryDriver();
}
