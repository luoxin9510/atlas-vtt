import { describe, expect, it, vi } from 'vitest';
import { AssetLoader, STALL_MS } from '../../../apps/play/src/assets/AssetLoader.ts';
import { memoryCache, type BlobCache } from '../../../apps/play/src/assets/blobCache.ts';
import { sha256Hex } from '../../../apps/play/src/assets/sha256.ts';
import { fetchTicket } from '../../../apps/play/src/assets/ticketFetch.ts';
import { assetChunks } from '../../../src/app/online/gm/assetServe.ts';
import type { AssetRef, GmMessage, PlayerMessage } from '../../../src/app/online/protocol/index.ts';

const png = new Uint8Array(1024 * 1024 + 123);
for (let i = 0; i < png.length; i += 1) png[i] = (i * 31 + (i >> 8)) & 255;
png.set([137, 80, 78, 71]);
const hash = await sha256Hex(png);
const ref: AssetRef = { hash, size: png.length, mime: 'image/png' };

function setup(cache: BlobCache = memoryCache(), fetcher?: typeof fetch): { loader: AssetLoader; sent: PlayerMessage[]; clock: { now: number }; cache: BlobCache; fallbacks: string[] } {
  const sent: PlayerMessage[] = [];
  const fallbacks: string[] = [];
  const clock = { now: 0 };
  const loader = new AssetLoader({
    send: (body) => void sent.push(body), cache, now: () => clock.now,
    ...(fetcher === undefined ? {} : { fetch: fetcher }), onFallback: (h) => void fallbacks.push(h),
  });
  return { loader, sent, clock, cache, fallbacks };
}

const TICKET_PATH = (h: string): string => `/api/assets/${h}?t=${'a'.repeat(26)}.${'b'.repeat(20)}.9999999999999.${'c'.repeat(43)}`;
const ticketOf = (h: string): GmMessage => ({ t: 'asset-ticket', hash: h, url: TICKET_PATH(h), expires: 9_999_999_999_999 });
const okFetch = (bytes: Uint8Array): ReturnType<typeof vi.fn<typeof fetch>> => vi.fn<typeof fetch>(async () => new Response(bytes.slice(), { status: 200 }));

const feed = (loader: AssetLoader, messages: readonly GmMessage[]): void => {
  for (const message of messages) expect(loader.receive(message)).toBe(true);
};
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('AssetLoader', () => {
  it('assembles in-order chunks into verified bytes', async () => {
    const { loader, sent } = setup();
    const result = loader.load(ref, null);
    await flush();
    expect(sent).toEqual([{ t: 'asset-request', hash }]);
    feed(loader, assetChunks(hash, png));
    const asset = await result;
    expect(asset?.bytes).toEqual(png);
    expect(asset).toMatchObject({ mime: 'image/png', width: null, height: null });
  });

  it('assembles shuffled chunks', async () => {
    const { loader } = setup();
    const result = loader.load(ref, null);
    await flush();
    feed(loader, [...assetChunks(hash, png)].reverse());
    expect((await result)?.bytes).toEqual(png);
  });

  it('asks again once for a corrupted download, then gives up', async () => {
    const { loader, sent } = setup();
    const bad = (): GmMessage[] => {
      const copy = png.slice();
      copy[5000] ^= 1;
      return assetChunks(hash, copy);
    };
    const result = loader.load(ref, null);
    await flush();
    feed(loader, bad());
    await flush();
    expect(sent).toHaveLength(2);
    feed(loader, bad());
    expect(await result).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('recovers when the second try is good', async () => {
    const { loader } = setup();
    const result = loader.load(ref, null);
    await flush();
    const copy = png.slice();
    copy[7] ^= 1;
    feed(loader, assetChunks(hash, copy));
    await flush();
    feed(loader, assetChunks(hash, png));
    expect((await result)?.bytes).toEqual(png);
  });

  it('resolves null when the GM refuses', async () => {
    const { loader } = setup();
    const result = loader.load(ref, null);
    await flush();
    expect(loader.receive({ t: 'asset-refused', hash })).toBe(true);
    expect(await result).toBeNull();
  });

  it('asks again from the first missing chunk after 10 s, at most 3 times, then gives up', async () => {
    const { loader, sent, clock } = setup();
    const result = loader.load(ref, null);
    await flush();
    const chunks = assetChunks(hash, png);
    feed(loader, chunks.slice(0, 2));
    clock.now = STALL_MS - 1;
    loader.tick();
    expect(sent).toHaveLength(1);
    for (const asks of [1, 2, 3]) {
      clock.now += STALL_MS;
      loader.tick();
      expect(sent).toHaveLength(1 + asks);
      expect(sent.at(-1)).toEqual({ t: 'asset-request', hash, from: 2 });
    }
    clock.now += STALL_MS;
    loader.tick();
    expect(await result).toBeNull();
    expect(sent).toHaveLength(4);
  });

  it('counts progress against the stall timer', async () => {
    const { loader, sent, clock } = setup();
    void loader.load(ref, null);
    await flush();
    const chunks = assetChunks(hash, png);
    clock.now = 9000;
    feed(loader, chunks.slice(0, 1));
    clock.now = 15_000;
    loader.tick();
    expect(sent).toHaveLength(1);
  });

  it('maps a variant and returns the width and height of the message', async () => {
    const { loader, sent, cache } = setup();
    const small = png.slice(0, 5000);
    const variant: AssetRef = { hash: await sha256Hex(small), size: small.length, mime: 'image/png' };
    const result = loader.load(ref, 512);
    await flush();
    expect(sent).toEqual([{ t: 'asset-request', hash, maxSide: 512 }]);
    feed(loader, [{ t: 'asset-variant', hash, maxSide: 512, variant, width: 3000, height: 2000 }, ...assetChunks(variant.hash, small)]);
    const asset = await result;
    expect(asset).toMatchObject({ width: 3000, height: 2000 });
    expect(asset?.bytes).toEqual(small);
    expect(await cache.get(variant.hash)).toEqual(small);
    expect(await cache.get(hash)).toBeNull();
    // The variant is remembered in memory: no request the second time.
    const again = await loader.load(ref, 512);
    expect(again).toMatchObject({ width: 3000, height: 2000 });
    expect(sent).toHaveLength(1);
  });

  it('serves a second load from the cache with no request', async () => {
    const { loader, sent } = setup();
    const first = loader.load(ref, null);
    await flush();
    feed(loader, assetChunks(hash, png));
    await first;
    const again = await loader.load(ref, null);
    expect(again?.bytes).toEqual(png);
    expect(sent).toHaveLength(1);
  });

  it('shares one download between concurrent loads', async () => {
    const { loader, sent } = setup();
    const a = loader.load(ref, null);
    const b = loader.load(ref, null);
    await flush();
    feed(loader, assetChunks(hash, png));
    expect((await a)?.bytes).toEqual((await b)?.bytes);
    expect(sent).toHaveLength(1);
  });

  it('ignores a chunk whose count does not fit the size by dropping the download once', async () => {
    const { loader, sent } = setup();
    const result = loader.load(ref, null);
    await flush();
    loader.receive({ t: 'asset-chunk', hash, index: 0, count: 2, data: '' });
    expect(sent).toHaveLength(2);
    loader.receive({ t: 'asset-chunk', hash, index: 0, count: 2, data: '' });
    expect(await result).toBeNull();
  });

  it('cancelAll resolves open downloads with null; other messages are not assets', async () => {
    const { loader } = setup();
    const result = loader.load(ref, null);
    await flush();
    loader.cancelAll();
    expect(await result).toBeNull();
    expect(loader.receive({ t: 'resync', scene: 's', of: 'tokens' } as unknown as GmMessage)).toBe(false);
  });

  it('retries a corrupt download once even when its last chunk arrives twice', async () => {
    const { loader, sent } = setup();
    const result = loader.load(ref, null);
    await flush();
    const copy = png.slice();
    copy[5000] ^= 1;
    const chunks = assetChunks(hash, copy);
    feed(loader, [...chunks, chunks[chunks.length - 1] as GmMessage]);
    await flush();
    expect(sent).toHaveLength(2);
    feed(loader, assetChunks(hash, png));
    expect((await result)?.bytes).toEqual(png);
  });

  it('caches a good download once when its last chunk arrives twice', async () => {
    const puts: string[] = [];
    const inner = memoryCache();
    const { loader } = setup({ get: (h) => inner.get(h), put: (h, b) => (puts.push(h), inner.put(h, b)) });
    const result = loader.load(ref, null);
    await flush();
    const chunks = assetChunks(hash, png);
    feed(loader, [...chunks, chunks[chunks.length - 1] as GmMessage]);
    await result;
    await flush();
    expect(puts).toEqual([hash]);
  });

  it('cancel resolves that download null and stops asking for it', async () => {
    const { loader, sent, clock } = setup();
    const result = loader.load(ref, null);
    await flush();
    loader.cancel(hash);
    expect(await result).toBeNull();
    clock.now = 60_000;
    loader.tick();
    expect(sent).toHaveLength(1);
  });

  it('asks nothing while the table is not connected: pending downloads end, new ones answer null, re-asks wait', async () => {
    const { loader, sent, clock } = setup();
    const first = loader.load(ref, null);
    await flush();
    loader.setConnected(false);
    expect(await first).toBeNull();
    expect(await loader.load(ref, null)).toBeNull();
    clock.now = 60_000;
    loader.tick();
    expect(sent).toHaveLength(1);
    loader.setConnected(true);
    void loader.load(ref, null);
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('treats a missing crypto.subtle (an http page) as a failed download, not an unhandled error', async () => {
    const { loader } = setup();
    const result = loader.load(ref, null);
    await flush();
    vi.stubGlobal('crypto', {});
    try {
      feed(loader, assetChunks(hash, png));
      expect(await result).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('tickets', () => {
    it('downloads by ticket, caches by hash and sends no chunk request', async () => {
      const fetcher = okFetch(png);
      const { loader, sent, cache } = setup(memoryCache(), fetcher);
      const result = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      const asset = await result;
      expect(asset?.bytes).toEqual(png);
      expect(await cache.get(hash)).toEqual(png);
      expect(sent).toEqual([{ t: 'asset-request', hash }]);
    });

    it('fetches the ticket url exactly as given, without credentials or cache', async () => {
      const fetcher = okFetch(png);
      const { loader } = setup(memoryCache(), fetcher);
      const result = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await result;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(TICKET_PATH(hash), { credentials: 'omit', cache: 'no-store' });
    });

    it('loads a variant by ticket at the variant world size', async () => {
      const small = png.slice(0, 5000);
      const variant: AssetRef = { hash: await sha256Hex(small), size: small.length, mime: 'image/png' };
      const { loader, cache } = setup(memoryCache(), okFetch(small));
      const result = loader.load(ref, 512);
      await flush();
      feed(loader, [{ t: 'asset-variant', hash, maxSide: 512, variant, width: 3000, height: 2000 }, ticketOf(variant.hash)]);
      const asset = await result;
      expect(asset).toMatchObject({ width: 3000, height: 2000 });
      expect(asset?.bytes).toEqual(small);
      expect(await cache.get(variant.hash)).toEqual(small);
    });

    it('falls back once on a failed ticket', async () => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response('no', { status: 404 }));
      const { loader, sent, fallbacks, clock } = setup(memoryCache(), fetcher);
      const result = loader.load(ref, 512);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await flush();
      expect(sent).toEqual([{ t: 'asset-request', hash, maxSide: 512 }, { t: 'asset-request', hash, maxSide: 512, via: 'socket' }]);
      expect(fallbacks).toEqual([hash]);
      // A second ticket for the same hash is ignored.
      feed(loader, [ticketOf(hash)]);
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fallbacks).toHaveLength(1);
      // Later asks (a stall re-ask) still say via socket.
      clock.now += STALL_MS;
      loader.tick();
      expect(sent.at(-1)).toEqual({ t: 'asset-request', hash, maxSide: 512, via: 'socket' });
      feed(loader, assetChunks(hash, png));
      expect((await result)?.bytes).toEqual(png);
    });

    it('remembers a fallback across a reconnect and a new load, with one notice', async () => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response('no', { status: 404 }));
      const { loader, sent, fallbacks } = setup(memoryCache(), fetcher);
      const first = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await flush();
      loader.setConnected(false);
      expect(await first).toBeNull();
      loader.setConnected(true);
      const again = loader.load(ref, null);
      await flush();
      expect(sent.at(-1)).toEqual({ t: 'asset-request', hash, via: 'socket' });
      feed(loader, [ticketOf(hash)]);
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1);
      feed(loader, assetChunks(hash, png));
      expect((await again)?.bytes).toEqual(png);
      expect(fallbacks).toEqual([hash]);
    });

    it('never re-asks without via while a good ticket is being cached', async () => {
      let release: () => void = () => undefined;
      const slow: BlobCache = {
        get: async () => null,
        put: () => new Promise<void>((resolve) => { release = resolve; }),
      };
      const { loader, sent, clock } = setup(slow, okFetch(png));
      const result = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await flush();
      clock.now += STALL_MS;
      loader.tick();
      expect(sent.slice(1).every((m) => m.t === 'asset-request' && m.via === 'socket')).toBe(true);
      release();
      expect((await result)?.bytes).toEqual(png);
    });

    it('keeps via socket on the retry after a corrupted chunk download', async () => {
      const { loader, sent } = setup(memoryCache(), vi.fn<typeof fetch>(async () => new Response('', { status: 500 })));
      const result = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await flush();
      const copy = png.slice();
      copy[9] ^= 1;
      feed(loader, assetChunks(hash, copy));
      await flush();
      expect(sent.at(-1)).toEqual({ t: 'asset-request', hash, via: 'socket' });
      feed(loader, assetChunks(hash, png));
      expect((await result)?.bytes).toEqual(png);
    });

    it('falls back on wrong bytes and caches nothing', async () => {
      const wrong = png.slice();
      wrong[100] ^= 1;
      const { loader, sent, cache, fallbacks } = setup(memoryCache(), okFetch(wrong));
      const result = loader.load(ref, null);
      await flush();
      feed(loader, [ticketOf(hash)]);
      await flush();
      expect(await cache.get(hash)).toBeNull();
      expect(sent.at(-1)).toEqual({ t: 'asset-request', hash, via: 'socket' });
      expect(fallbacks).toEqual([hash]);
      feed(loader, assetChunks(hash, png));
      expect((await result)?.bytes).toEqual(png);
    });

    it('ignores a ticket for a hash with no pending download', async () => {
      const fetcher = okFetch(png);
      const { loader, sent } = setup(memoryCache(), fetcher);
      expect(loader.receive(ticketOf(hash))).toBe(true);
      await flush();
      expect(fetcher).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });
  });

  describe('fetchTicket', () => {
    it('returns the bytes of a 200', async () => {
      expect(await fetchTicket(okFetch(png), '/x', png.length)).toEqual(png);
    });
    it('is null on a non-200, a network error and an oversize body', async () => {
      expect(await fetchTicket(vi.fn<typeof fetch>(async () => new Response('', { status: 404 })), '/x', 10)).toBeNull();
      expect(await fetchTicket(vi.fn<typeof fetch>(async () => { throw new Error('net'); }), '/x', 10)).toBeNull();
      expect(await fetchTicket(okFetch(png), '/x', png.length - 1)).toBeNull();
    });
  });
});
