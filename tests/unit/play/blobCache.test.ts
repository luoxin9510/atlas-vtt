import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { indexedDbCache, memoryCache } from '../../../apps/play/src/assets/blobCache.ts';

const bytes = new Uint8Array([1, 2, 3, 250]);

describe('indexedDbCache', () => {
  it('round-trips bytes by hash and misses for an unknown hash', async () => {
    const cache = indexedDbCache(new IDBFactory());
    expect(await cache.get('a')).toBeNull();
    await cache.put('a', bytes);
    expect(await cache.get('a')).toEqual(bytes);
    expect(await cache.get('b')).toBeNull();
  });

  it('keeps bytes in the same database for a second cache', async () => {
    const factory = new IDBFactory();
    await indexedDbCache(factory).put('a', bytes);
    expect(await indexedDbCache(factory).get('a')).toEqual(bytes);
  });

  it('reads a miss and ignores a write when the factory throws', async () => {
    const broken = { open: (): never => { throw new Error('denied'); } } as unknown as IDBFactory;
    const cache = indexedDbCache(broken);
    expect(await cache.get('a')).toBeNull();
    await expect(cache.put('a', bytes)).resolves.toBeUndefined();
  });
});

describe('memoryCache', () => {
  it('round-trips bytes', async () => {
    const cache = memoryCache();
    expect(await cache.get('a')).toBeNull();
    await cache.put('a', bytes);
    expect(await cache.get('a')).toEqual(bytes);
  });
});

describe('indexedDbCache recovery', () => {
  it('opens again after the first open failed', async () => {
    const real = new IDBFactory();
    let calls = 0;
    const flaky = { open: (...args: Parameters<IDBFactory['open']>): IDBOpenDBRequest => {
      calls += 1;
      if (calls === 1) throw new Error('denied');
      return real.open(...args);
    } } as unknown as IDBFactory;
    const cache = indexedDbCache(flaky);
    expect(await cache.get('a')).toBeNull();
    await cache.put('a', bytes);
    expect(await cache.get('a')).toEqual(bytes);
  });
});
