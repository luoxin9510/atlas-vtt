import { ASSET_CHUNK_BYTES, type AssetRef, type GmMessage, type PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import type { BlobCache } from './blobCache.ts';
import { sha256Hex } from './sha256.ts';

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
    return new Promise((resolve) => {
      this.downloads.set(ref.hash, {
        ref, maxSide, expected: ref, variant: null, chunks: new Map(), count: null,
        lastProgress: this.ports.now(), reasks: 0, retried: false, settle: resolve,
      });
      this.request(ref.hash, maxSide, 0);
    });
  }

  private request(hash: string, maxSide: number | null, from: number): void {
    this.ports.send({ t: 'asset-request', hash, ...(from > 0 ? { from } : {}), ...(maxSide === null ? {} : { maxSide }) });
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
    if (offset !== expected.size || (await sha256Hex(bytes)) !== expected.hash) return this.fail(download);
    if (this.downloads.get(download.ref.hash) !== download) return;
    await this.ports.cache.put(expected.hash, bytes);
    const { variant } = download;
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
    this.request(download.ref.hash, download.maxSide, 0);
  }

  private finish(hash: string, asset: LoadedAsset | null): void {
    const download = this.downloads.get(hash) ?? this.find(hash);
    if (download === undefined) return;
    this.downloads.delete(download.ref.hash);
    download.settle(asset);
  }

  /** Asks again, from the first missing chunk, for each download that has been still for `STALL_MS`. */
  tick(): void {
    const now = this.ports.now();
    for (const download of [...this.downloads.values()]) {
      if (now - download.lastProgress < STALL_MS) continue;
      if (download.reasks >= MAX_REASKS) {
        this.finish(download.ref.hash, null);
        continue;
      }
      download.reasks += 1;
      download.lastProgress = now;
      let first = 0;
      while (download.chunks.has(first)) first += 1;
      this.request(download.ref.hash, download.maxSide, first);
    }
  }

  /** Gives up every download (the connection is gone). */
  cancelAll(): void {
    for (const download of [...this.downloads.values()]) this.finish(download.ref.hash, null);
  }
}
