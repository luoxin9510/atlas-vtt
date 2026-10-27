import { parseAssetTicket, type AssetTicketMessage } from '../../protocol/index.ts';
import type { BinaryHttp } from './binaryHttp.ts';
import { assetUrl, uploadAsset, type TableAccess } from './uploadAsset.ts';

/** A hash whose upload failed is not tried again for this long. */
export const RETRY_AFTER_MS = 60_000;
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
  private readonly failed = new Map<string, number>();
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
    const failedAt = this.failed.get(hash);
    if (failedAt !== undefined && this.now() - failedAt < RETRY_AFTER_MS) return false;
    let upload = this.uploading.get(hash);
    if (upload === undefined) {
      const started = uploadAsset(this.http, this.table, hash, bytes).catch(() => false);
      upload = started.then((ok) => {
        this.uploading.delete(hash);
        if (ok) this.uploaded.add(hash);
        else this.failed.set(hash, this.now());
        return ok;
      });
      this.uploading.set(hash, upload);
    }
    return upload;
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
