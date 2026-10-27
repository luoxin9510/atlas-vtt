/** Downloaded assets kept by hash. Every failure reads as a miss and a failed write is ignored. */
export interface BlobCache {
  get(hash: string): Promise<Uint8Array | null>;
  put(hash: string, bytes: Uint8Array): Promise<void>;
}

const STORE = 'blobs';

/** A cache that lives as long as the page. */
export function memoryCache(): BlobCache {
  const blobs = new Map<string, Uint8Array>();
  return {
    get: (hash) => Promise.resolve(blobs.get(hash) ?? null),
    put: (hash, bytes) => {
      blobs.set(hash, bytes);
      return Promise.resolve();
    },
  };
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error);
    request.onblocked = (): void => reject(new Error('blocked'));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error);
  });
}

/** A cache in one object store (`blobs`) of the database `name`, opened on first use. */
export function indexedDbCache(factory: IDBFactory, name = 'atlas-play-assets'): BlobCache {
  let db: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    db ??= open(factory, name);
    return db;
  };
  return {
    async get(hash: string): Promise<Uint8Array | null> {
      try {
        const store = (await database()).transaction(STORE, 'readonly').objectStore(STORE);
        const value: unknown = await done(store.get(hash));
        return value instanceof Uint8Array ? value : null;
      } catch {
        return null;
      }
    },
    async put(hash: string, bytes: Uint8Array): Promise<void> {
      try {
        const transaction = (await database()).transaction(STORE, 'readwrite');
        const finished = new Promise<void>((resolve, reject) => {
          transaction.oncomplete = (): void => resolve();
          transaction.onerror = (): void => reject(transaction.error);
          transaction.onabort = (): void => reject(transaction.error);
        });
        transaction.objectStore(STORE).put(bytes, hash);
        await finished;
      } catch {
        // A cache that cannot be written is only slower.
      }
    },
  };
}
