import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_ASSET_BYTES } from '../../../../src/app/online/protocol/asset.ts';
import { TABLE_CODE_PATTERN } from '../../../../src/app/online/protocol/relay.ts';
import type { RelayConfig } from '../config.ts';
import { sniffImage, SNIFF_BYTES } from './sniff.ts';

const GIB = 1024 ** 3;
/** The size of one upload part, and so how many parts an asset has at most (0..7). */
export const PART_BYTES = 8 * 1024 * 1024;
export const MAX_PARTS = MAX_ASSET_BYTES / PART_BYTES;
export const MAX_IN_FLIGHT = 2;
export const MAX_UNFINISHED = 4;
/** Unfinished parts are deleted when nothing was added for this long; the sweep looks this often. */
export const PARTS_STALE_MS = 3_600_000;
export const SWEEP_INTERVAL_MS = 600_000;

export interface AssetLimits {
  readonly maxTableBytes: number;
  readonly maxServerBytes: number;
  readonly minFreeBytes: number;
}

export function assetLimitsOf(config: RelayConfig): AssetLimits {
  return { maxTableBytes: config.maxTableAssetBytes ?? 2 * GIB, maxServerBytes: config.maxServerAssetBytes ?? 10 * GIB, minFreeBytes: config.minFreeBytes ?? 2 * GIB };
}

export type StoreFailure = 400 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 507;
export type PartResult = { readonly status: 200 } | { readonly status: StoreFailure };
export type CompleteResult = PartResult;

class StoreError extends Error {
  constructor(readonly status: StoreFailure) {
    super(`asset store: ${status}`);
  }
}

interface TableAssets {
  readonly complete: Map<string, { size: number; mime: string }>;
  /** Hashes with parts (or an upload about to add the first), each with the size of every part held. */
  readonly parts: Map<string, Map<number, number>>;
  readonly completing: Set<string>;
  bytes: number;
  inFlight: number;
  /** The table ended: nothing it counted is counted any more. */
  gone: boolean;
}

const HASH_FILE = /^[0-9a-f]{64}$/;
const sum = (sizes: Map<number, number>): number => [...sizes.values()].reduce((a, b) => a + b, 0);

/** Images on disk: `<dir>/<code>/<hash>` when complete, `<dir>/<code>/.parts/<hash>/<index>` while uploading. */
export class AssetStore {
  readonly #tables = new Map<string, TableAssets>();
  #serverBytes = 0;

  constructor(
    private readonly dir: string,
    private readonly limits: AssetLimits,
    private readonly now: () => number,
  ) {}

  /** Opens the folder and counts what a former run left (leftover temporary files are removed). */
  static async open(dir: string, limits: AssetLimits, now: () => number): Promise<AssetStore> {
    const store = new AssetStore(dir, limits, now);
    await mkdir(dir, { recursive: true });
    for (const code of await readdir(dir)) if (TABLE_CODE_PATTERN.test(code)) await store.#scan(code);
    return store;
  }

  has(code: string, hash: string): boolean {
    return this.#tables.get(code)?.complete.has(hash) === true;
  }

  inFlight(code: string): number {
    return this.#tables.get(code)?.inFlight ?? 0;
  }

  status(code: string, hash: string): { complete: true } | { parts: number[] } {
    const table = this.#tables.get(code);
    if (table?.complete.has(hash) === true) return { complete: true };
    return { parts: [...(table?.parts.get(hash)?.keys() ?? [])].sort((a, b) => a - b) };
  }

  /** The complete image to send, or null. */
  open(code: string, hash: string): { stream: ReadStream; mime: string; size: number } | null {
    const entry = this.#tables.get(code)?.complete.get(hash);
    return entry === undefined ? null : { stream: createReadStream(join(this.dir, code, hash)), mime: entry.mime, size: entry.size };
  }

  /** Streams a request body into part `index`; sizes are counted while it arrives and a refused part leaves no file. */
  async writePart(code: string, hash: string, index: number, body: Readable): Promise<PartResult> {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) return { status: 400 };
    const table = this.#table(code);
    if (table.complete.has(hash)) {
      body.resume();
      return { status: 200 };
    }
    if (table.completing.has(hash)) return { status: 409 };
    if (table.inFlight >= MAX_IN_FLIGHT || (!table.parts.has(hash) && table.parts.size >= MAX_UNFINISHED)) return { status: 429 };
    table.inFlight += 1;
    const held = table.parts.get(hash) ?? new Map<number, number>();
    table.parts.set(hash, held);
    let reserved = 0;
    const folder = join(this.dir, code, '.parts', hash);
    const temporary = join(folder, `${index}.tmp`);
    try {
      if (await this.#diskLow()) throw new StoreError(507);
      await mkdir(folder, { recursive: true });
      const others = sum(held) - (held.get(index) ?? 0);
      const guard = this.#guard(table, index === 0, others, (bytes) => (reserved += bytes));
      await pipeline(body, guard, createWriteStream(temporary));
      await rename(temporary, join(folder, String(index)));
      const old = held.get(index) ?? 0;
      held.set(index, reserved);
      this.#add(table, -old);
      return { status: 200 };
    } catch (error) {
      this.#add(table, -reserved);
      await rm(temporary, { force: true }).catch(() => undefined);
      if (held.size === 0 && !table.gone) await this.#dropParts(code, table, hash);
      return { status: failureOf(error) };
    } finally {
      table.inFlight -= 1;
    }
  }

  /** Joins the parts into the image, checks its SHA-256, and keeps it under its hash. Idempotent. */
  async complete(code: string, hash: string): Promise<CompleteResult> {
    const table = this.#table(code);
    if (table.complete.has(hash)) return { status: 200 };
    const held = table.parts.get(hash);
    if (table.completing.has(hash) || held === undefined || held.size === 0) return { status: 409 };
    const count = held.size;
    for (let i = 0; i < count; i += 1) if (!held.has(i)) return { status: 409 };
    if (sum(held) > MAX_ASSET_BYTES) {
      await this.#dropParts(code, table, hash);
      return { status: 413 };
    }
    table.completing.add(hash);
    const temporary = join(this.dir, code, `${hash}.tmp`);
    try {
      const digest = createHash('sha256');
      let head = Buffer.alloc(0);
      const chunks = async function* (folder: string): AsyncGenerator<Buffer> {
        for (let i = 0; i < count; i += 1) {
          for await (const chunk of createReadStream(join(folder, String(i)))) {
            const piece = chunk as Buffer;
            digest.update(piece);
            if (head.length < SNIFF_BYTES) head = Buffer.concat([head, piece]).subarray(0, SNIFF_BYTES);
            yield piece;
          }
        }
      };
      await pipeline(Readable.from(chunks(join(this.dir, code, '.parts', hash))), createWriteStream(temporary));
      const mime = sniffImage(head);
      if (mime === null || digest.digest('hex') !== hash) {
        await rm(temporary, { force: true });
        await this.#dropParts(code, table, hash);
        return { status: mime === null ? 415 : 422 };
      }
      await rename(temporary, join(this.dir, code, hash));
      table.complete.set(hash, { size: sum(held), mime });
      table.parts.delete(hash);
      await rm(join(this.dir, code, '.parts', hash), { recursive: true, force: true });
      return { status: 200 };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      return { status: failureOf(error) };
    } finally {
      table.completing.delete(hash);
    }
  }

  /** Deletes the images of every table the registry no longer knows (it ended while the relay was down or starting). */
  async purgeUnknown(has: (code: string) => boolean): Promise<void> {
    for (const code of await readdir(this.dir)) if (TABLE_CODE_PATTERN.test(code) && !has(code)) await this.deleteTable(code);
  }

  /** The table ended: its images go. */
  async deleteTable(code: string): Promise<void> {
    const table = this.#tables.get(code);
    if (table !== undefined) {
      table.gone = true;
      this.#serverBytes -= table.bytes;
      this.#tables.delete(code);
    }
    await rm(join(this.dir, code), { recursive: true, force: true });
  }

  /** Removes the parts of uploads nothing was added to for an hour. */
  async sweep(): Promise<void> {
    for (const [code, table] of [...this.#tables]) {
      for (const hash of [...table.parts.keys()]) {
        if (table.completing.has(hash)) continue;
        const touched = await stat(join(this.dir, code, '.parts', hash)).then((info) => info.mtimeMs, () => 0);
        if (this.now() - touched > PARTS_STALE_MS) await this.#dropParts(code, table, hash);
      }
    }
  }

  #table(code: string): TableAssets {
    let table = this.#tables.get(code);
    if (table === undefined) {
      table = { complete: new Map(), parts: new Map(), completing: new Set(), bytes: 0, inFlight: 0, gone: false };
      this.#tables.set(code, table);
    }
    return table;
  }

  #add(table: TableAssets, bytes: number): void {
    if (table.gone) return;
    table.bytes += bytes;
    this.#serverBytes += bytes;
  }

  async #dropParts(code: string, table: TableAssets, hash: string): Promise<void> {
    const held = table.parts.get(hash);
    if (held !== undefined) this.#add(table, -sum(held));
    table.parts.delete(hash);
    await rm(join(this.dir, code, '.parts', hash), { recursive: true, force: true });
  }

  async #diskLow(): Promise<boolean> {
    try {
      const space = await statfs(this.dir);
      return space.bavail * space.bsize < this.limits.minFreeBytes;
    } catch {
      return false;
    }
  }

  /** Counts a part while it streams: over 8 MiB or 64 MiB in all is 413, over a storage cap 507, a first part that is no image 415. */
  #guard(table: TableAssets, first: boolean, others: number, reserve: (bytes: number) => void): Transform {
    let written = 0;
    let head = Buffer.alloc(0);
    let sniffed = false;
    let over = false;
    const check = (): void => {
      if (sniffImage(head) === null) throw new StoreError(415);
      sniffed = true;
    };
    return new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        try {
          written += chunk.length;
          // Too much: read on and drop the rest (up to twice a part) so the 413 reaches the client before the connection ends.
          if (written > 2 * PART_BYTES) throw new StoreError(413);
          if (over || written > PART_BYTES || others + written > MAX_ASSET_BYTES) {
            over = true;
            return done();
          }
          reserve(chunk.length);
          this.#add(table, chunk.length);
          if (table.bytes > this.limits.maxTableBytes || this.#serverBytes > this.limits.maxServerBytes) throw new StoreError(507);
          if (first && !sniffed) {
            head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
            if (head.length >= SNIFF_BYTES) check();
          }
          done(null, chunk);
        } catch (error) {
          done(error as Error);
        }
      },
      flush: (done) => {
        try {
          if (over) throw new StoreError(413);
          if (first && !sniffed) check();
          done();
        } catch (error) {
          done(error as Error);
        }
      },
    });
  }

  async #scan(code: string): Promise<void> {
    const table = this.#table(code);
    const folder = join(this.dir, code);
    for (const entry of await readdir(folder)) {
      if (entry.endsWith('.tmp')) await rm(join(folder, entry), { force: true });
      else if (HASH_FILE.test(entry)) await this.#scanComplete(table, folder, entry);
    }
    const parts = join(folder, '.parts');
    for (const hash of await readdir(parts).catch(() => [])) {
      const held = new Map<number, number>();
      for (const name of await readdir(join(parts, hash))) {
        if (name.endsWith('.tmp')) await rm(join(parts, hash, name), { force: true });
        else if (/^[0-7]$/.test(name)) held.set(Number(name), (await stat(join(parts, hash, name))).size);
      }
      if (held.size > 0) table.parts.set(hash, held);
      this.#add(table, sum(held));
    }
  }

  async #scanComplete(table: TableAssets, folder: string, hash: string): Promise<void> {
    const file = await open(join(folder, hash), 'r');
    try {
      const head = Buffer.alloc(SNIFF_BYTES);
      const { bytesRead } = await file.read(head, 0, SNIFF_BYTES, 0);
      const mime = sniffImage(head.subarray(0, bytesRead));
      const { size } = await file.stat();
      if (mime !== null) table.complete.set(hash, { size, mime });
      this.#add(table, size);
    } finally {
      await file.close();
    }
  }
}

function failureOf(error: unknown): StoreFailure {
  if (error instanceof StoreError) return error.status;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return 404;
  if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET' || code === 'ABORT_ERR') return 400;
  return 500;
}
