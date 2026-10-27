import { ASSET_CHUNK_BYTES, type AssetRef, type GmMessage, type PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import type { BlobCache } from './blobCache.ts';
import { sha256Hex } from './sha256.ts';
import { fetchTicket } from './ticketFetch.ts';

export type LoadedAsset = {
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** The world size to draw at, from `asset-variant`; null for an asset that came as itself. */
  readonly width: number | null;
  readonly height: number | null;
};

export interface LoaderPorts {
  send(body: PlayerMessage): void;
  cache: BlobCache;
  now(): number;
  /** Downloads a ticket url; the page's own `fetch` when absent. */
  fetch?: typeof fetch;
  /** Called once per image when it falls back from a ticket to the GM's socket. */
  onFallback?: (hash: string) => void;
}

/** A download with no new chunk for this long is asked again. */
export const STALL_MS = 10_000;
/** How often one download is asked again before it is given up. */
export const MAX_REASKS = 3;

interface Variant {
  readonly ref: AssetRef;
  readonly width: number;
  readonly height: number;
}

interface Download {
  readonly ref: AssetRef;
  readonly maxSide: number | null;
  /** What the chunks are named by: the requested hash, or the variant's once the GM names it. */
  expected: AssetRef;
  variant: Variant | null;
  chunks: Map<number, Uint8Array>;
  count: number | null;
  lastProgress: number;
  reasks: number;
  retried: boolean;
  /** A ticket is being downloaded: no re-ask meanwhile. */
  ticketing: boolean;
  /** Fallen back to chunks: every later request says so, or the GM answers with a ticket again. */
  viaSocket: boolean;
  readonly settle: (asset: LoadedAsset | null) => void;
}

const chunkCount = (size: number): number => Math.max(1, Math.ceil(size / ASSET_CHUNK_BYTES));

function decode(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Fetches assets by hash from the GM in chunks, verifies them by SHA-256 and keeps them in a cache. */
export class AssetLoader {
  private readonly downloads = new Map<string, Download>();
  private readonly pending = new Map<string, Promise<LoadedAsset | null>>();
  /** Which variant a requested hash and longest side were answered with: in memory only. */
  private readonly variants = new Map<string, Variant>();
  /** Hashes (requested and expected) that already fell back to the socket: later loads ask by socket at once and the notice is not repeated. */
  private readonly fallenBack = new Set<string>();
  /** Whether the GM can be asked now (joined, GM online); asks and re-asks wait for it. */
  private connected = true;

  constructor(private readonly ports: LoaderPorts) {}

  load(ref: AssetRef, maxSide: number | null): Promise<LoadedAsset | null> {
    const running = this.pending.get(ref.hash);
    if (running !== undefined) return running;
    const promise = this.fetch(ref, maxSide).finally(() => this.pending.delete(ref.hash));
    this.pending.set(ref.hash, promise);
    return promise;
  }

  private async fetch(ref: AssetRef, maxSide: number | null): Promise<LoadedAsset | null> {
    const variant = this.variants.get(`${ref.hash}@${maxSide ?? ''}`);
    if (variant !== undefined) {
      const bytes = await this.ports.cache.get(variant.ref.hash);
      if (bytes !== null) return { bytes, mime: variant.ref.mime, width: variant.width, height: variant.height };
    }
    const own = await this.ports.cache.get(ref.hash);
    if (own !== null) return { bytes: own, mime: ref.mime, width: null, height: null };
    // Without a connection nothing can be asked: the caller hears null and tries again when it is back.
    if (!this.connected) return null;
    return new Promise((resolve) => {
      const download: Download = {
        ref, maxSide, expected: ref, variant: null, chunks: new Map(), count: null,
        lastProgress: this.ports.now(), reasks: 0, retried: false, ticketing: false, viaSocket: this.fallenBack.has(ref.hash), settle: resolve,
      };
      this.downloads.set(ref.hash, download);
      this.request(download, 0);
    });
  }

  private request(download: Download, from: number): void {
    const { maxSide, viaSocket } = download;
    this.ports.send({
      t: 'asset-request', hash: download.ref.hash, ...(from > 0 ? { from } : {}),
      ...(maxSide === null ? {} : { maxSide }), ...(viaSocket ? { via: 'socket' as const } : {}),
    });
  }

  /** A ticket: download it, verify it like chunks; on any failure ask for chunks, once. */
  private ticket(hash: string, url: string): void {
    const download = this.find(hash);
    if (download === undefined || download.ticketing || download.viaSocket) return;
    download.ticketing = true;
    download.lastProgress = this.ports.now();
    const { expected } = download;
    const fetcher = this.ports.fetch ?? globalThis.fetch.bind(globalThis);
    void (async (): Promise<void> => {
      const bytes = await fetchTicket(fetcher, url, expected.size);
      const good = bytes !== null && bytes.length === expected.size && (await sha256Hex(bytes).catch(() => null)) === expected.hash;
      if (this.downloads.get(download.ref.hash) !== download || !download.ticketing) return;
      if (!good) return this.fallBack(download);
      // Stays guarded (ticketing) until settled: a tick in the cache write must not re-ask without via.
      download.lastProgress = this.ports.now();
      await this.ports.cache.put(expected.hash, bytes).catch(() => undefined);
      if (this.downloads.get(download.ref.hash) !== download) return;
      this.settleWith(download, bytes);
    })();
  }

  /** Gives up the ticket for this image: chunks from here on, and one local notice. */
  private fallBack(download: Download): void {
    if (download.viaSocket) return;
    download.viaSocket = true;
    download.ticketing = false;
    download.chunks = new Map();
    download.count = null;
    download.lastProgress = this.ports.now();
    this.request(download, 0);
    const fresh = !this.fallenBack.has(download.ref.hash);
    this.fallenBack.add(download.ref.hash);
    this.fallenBack.add(download.expected.hash);
    if (fresh) this.ports.onFallback?.(download.ref.hash);
  }

  /** Handles a GM message if it is about an asset. */
  receive(message: GmMessage): boolean {
    switch (message.t) {
      case 'asset-variant': {
        const download = this.downloads.get(message.hash);
        if (download !== undefined && download.maxSide === message.maxSide && download.variant === null) {
          const variant = { ref: message.variant, width: message.width, height: message.height };
          download.variant = variant;
          download.expected = variant.ref;
          download.lastProgress = this.ports.now();
        }
        return true;
      }
      case 'asset-ticket':
        this.ticket(message.hash, message.url);
        return true;
      case 'asset-refused':
        this.finish(message.hash, null);
        return true;
      case 'asset-chunk':
        this.chunk(message.hash, message.index, message.count, message.data);
        return true;
      default:
        return false;
    }
  }

  private find(hash: string): Download | undefined {
    for (const download of this.downloads.values()) if (download.expected.hash === hash) return download;
    return undefined;
  }

  private chunk(hash: string, index: number, count: number, data: string): void {
    const download = this.find(hash);
    if (download === undefined) return;
    const bytes = decode(data);
    const expectedCount = chunkCount(download.expected.size);
    if (bytes === null || !Number.isInteger(index) || index < 0 || count !== expectedCount || index >= count || (download.count !== null && download.count !== count)) {
      this.fail(download);
      return;
    }
    // A chunk already held (a GM re-send) changes nothing: the download completes once.
    if (download.chunks.has(index)) return;
    download.count = count;
    download.lastProgress = this.ports.now();
    download.chunks.set(index, bytes);
    if (download.chunks.size === count) void this.complete(download);
  }

  private async complete(download: Download): Promise<void> {
    const { expected } = download;
    const bytes = new Uint8Array(expected.size);
    let offset = 0;
    for (let index = 0; index < chunkCount(expected.size); index += 1) {
      const part = download.chunks.get(index);
      if (part === undefined || offset + part.length > bytes.length) return this.fail(download);
      bytes.set(part, offset);
      offset += part.length;
    }
    if (offset !== expected.size) return this.fail(download);
    let digest: string;
    try {
      digest = await sha256Hex(bytes);
    } catch {
      // No crypto.subtle (an insecure page) or a platform error: the bytes cannot be verified, so they are not used.
      return this.finish(download.ref.hash, null);
    }
    if (digest !== expected.hash) return this.fail(download);
    if (this.downloads.get(download.ref.hash) !== download) return;
    await this.ports.cache.put(expected.hash, bytes).catch(() => undefined);
    this.settleWith(download, bytes);
  }

  /** Verified bytes of the download: remember its variant and resolve the load. */
  private settleWith(download: Download, bytes: Uint8Array): void {
    const { variant, expected } = download;
    if (variant !== null) this.variants.set(`${download.ref.hash}@${download.maxSide ?? ''}`, variant);
    this.finish(download.ref.hash, { bytes, mime: expected.mime, width: variant?.width ?? null, height: variant?.height ?? null });
  }

  /** A bad download is dropped and asked for once more, then given up. */
  private fail(download: Download): void {
    if (this.downloads.get(download.ref.hash) !== download) return;
    if (download.retried) return this.finish(download.ref.hash, null);
    download.retried = true;
    download.chunks = new Map();
    download.count = null;
    download.lastProgress = this.ports.now();
    this.request(download, 0);
  }

  private finish(hash: string, asset: LoadedAsset | null): void {
    const download = this.downloads.get(hash) ?? this.find(hash);
    if (download === undefined) return;
    this.downloads.delete(download.ref.hash);
    download.settle(asset);
  }

  /** Asks again, from the first missing chunk, for each download that has been still for `STALL_MS`. */
  tick(): void {
    if (!this.connected) return;
    const now = this.ports.now();
    for (const download of [...this.downloads.values()]) {
      if (now - download.lastProgress < STALL_MS) continue;
      // A ticket download that hangs is a failed ticket.
      if (download.ticketing) {
        this.fallBack(download);
        continue;
      }
      if (download.reasks >= MAX_REASKS) {
        this.finish(download.ref.hash, null);
        continue;
      }
      download.reasks += 1;
      download.lastProgress = now;
      let first = 0;
      while (download.chunks.has(first)) first += 1;
      this.request(download, first);
    }
  }

  /** Gives up one download and stops asking for it; its `load` resolves null. */
  cancel(hash: string): void {
    this.finish(hash, null);
  }

  /** Tells the loader whether the GM can be asked; losing the connection gives up every download. */
  setConnected(on: boolean): void {
    this.connected = on;
    if (!on) this.cancelAll();
  }

  /** Gives up every download (the connection is gone). */
  cancelAll(): void {
    for (const download of [...this.downloads.values()]) this.finish(download.ref.hash, null);
  }
}
