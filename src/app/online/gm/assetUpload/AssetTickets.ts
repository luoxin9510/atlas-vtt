import { parseAssetTicket, type AssetTicketMessage } from '../../protocol/index.ts';
import type { BinaryHttp } from './binaryHttp.ts';
import { assetUrl, tryUpload, type TableAccess } from './uploadAsset.ts';

/** A hash whose upload failed is not tried again for this long. */
export const RETRY_AFTER_MS = 60_000;
/** A hash the relay answered 429 for is tried again after this long. */
export const BUSY_RETRY_AFTER_MS = 10_000;
/** The relay lets a table have this many uploads in flight. */
export const MAX_UPLOADS = 2;
/** A ticket is not handed out again this close to its expiry. */
export const REUSE_MARGIN_MS = 10_000;

/**
 * Download tickets of a table's images: puts an image into the relay's cache once (concurrent asks
 * share one upload, an uploaded hash is remembered, a failed one rests for `RETRY_AFTER_MS`) and mints
 * a ticket for the player, reused until shortly before it expires. `null` always means "send the
 * chunks over the socket instead".
 */
export class AssetTickets {
  private readonly uploading = new Map<string, Promise<boolean>>();
  private readonly uploaded = new Set<string>();
  /** When each failed hash may be tried again. */
  private readonly failed = new Map<string, number>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly minted = new Map<string, AssetTicketMessage>();

  constructor(private readonly http: BinaryHttp, private readonly table: TableAccess, private readonly now: () => number) {}

  async ticket(hash: string, bytes: Uint8Array, player: string): Promise<AssetTicketMessage | null> {
    const key = `${hash}\n${player}`;
    const kept = this.minted.get(key);
    if (kept !== undefined && kept.expires - this.now() > REUSE_MARGIN_MS) return kept;
    if (!(await this.held(hash, bytes))) return null;
    const ticket = await this.mint(hash, player);
    if (ticket !== null) this.minted.set(key, ticket);
    return ticket;
  }

  /** Forgets everything known about the relay's cache (the table ended or its images were lost). */
  forget(): void {
    this.uploading.clear();
    this.uploaded.clear();
    this.failed.clear();
    this.minted.clear();
  }

  private async held(hash: string, bytes: Uint8Array): Promise<boolean> {
    if (this.uploaded.has(hash)) return true;
    const retryAt = this.failed.get(hash);
    if (retryAt !== undefined && this.now() < retryAt) return false;
    let upload = this.uploading.get(hash);
    if (upload === undefined) {
      upload = this.queued(() => tryUpload(this.http, this.table, hash, bytes).catch((): 'failed' => 'failed')).then((outcome) => {
        this.uploading.delete(hash);
        if (outcome === 'ok') this.uploaded.add(hash);
        else this.failed.set(hash, this.now() + (outcome === 'busy' ? BUSY_RETRY_AFTER_MS : RETRY_AFTER_MS));
        return outcome === 'ok';
      });
      this.uploading.set(hash, upload);
    }
    return upload;
  }

  /** Runs `job` once fewer than `MAX_UPLOADS` are running; the others wait in the order they came. */
  private async queued<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_UPLOADS) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await job();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  private async mint(hash: string, player: string): Promise<AssetTicketMessage | null> {
    const answer = await this.http({ url: assetUrl(this.table, hash, '/tickets'), method: 'POST', secret: this.table.secret, json: { player } }).catch(() => null);
    if (answer?.status !== 200 || typeof answer.json !== 'object' || answer.json === null) {
      // The relay lost the image (404): upload it again next time.
      if (answer?.status === 404) this.uploaded.delete(hash);
      return null;
    }
    return parseAssetTicket({ t: 'asset-ticket', hash, ...answer.json });
  }
}
