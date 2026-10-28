import { ASSET_TICKET_LEVEL, type GmMessage, type PlayerAssetRequest } from '../protocol/index.ts';
import { assetChunks, assetTag, ServedAssets, sha256Hex } from './assetServe.ts';
import type { AssetTickets } from './assetUpload/AssetTickets.ts';
import { AssetVariants, fitsWithin, type ScaleImage } from './assetVariants.ts';
import type { VaultImage } from './TokenShare.ts';

export interface AssetAnswerPorts {
  send(body: GmMessage, to: string, tag?: string): void;
  now(): number;
  readImage(path: string): Promise<VaultImage | null>;
  /** Scales an image for a player who asks for a longest side; without it players get originals only. */
  scaleImage?: ScaleImage | undefined;
  /** Download tickets from the server's image cache; without them (or for a player below level 2) images go as chunks. */
  tickets?: Pick<AssetTickets, 'ticket'> | undefined;
  /** The fork level a player's app declared; without it every player has level 0. */
  levelOf?(player: string): number;
}

/**
 * What a player may be sent now: the assets of their current picture. Each question names the player
 * who asks, for a picture that is not the same for everyone (a player's own book).
 */
export interface PictureAssets {
  /** The shared map's image, while one is shared. */
  map(player: string): { readonly hash: string; readonly bytes: Uint8Array; readonly mime: string } | null;
  /** The explored memory by hash, while it is the one players were sent. */
  explored(hash: string, player: string): Uint8Array | undefined;
  /** The vault path of artwork the picture shows (a token's or an initiative portrait's, an image of a quest's text), by hash. */
  artPath(hash: string, player: string): string | undefined;
  /** A text the picture names by hash (a quest's whole text), as its bytes. */
  text?(hash: string, player: string): Uint8Array | undefined;
}

/**
 * Answers players' asset requests: only for the map, the explored memory, artwork or a text of their
 * current picture, from the chunk they ask for on, and an image larger than a longest side they ask for as a
 * scaled copy (`AssetVariants`) announced by an `asset-variant` message. Anything else is refused.
 * An image goes as a download ticket to a player of level 2 or more who did not ask `via: 'socket'`,
 * and as chunks otherwise (the explored memory and texts always do).
 */
export class AssetAnswers {
  private readonly served = new ServedAssets();
  private readonly variants: AssetVariants | null;

  constructor(private readonly ports: AssetAnswerPorts, private readonly picture: PictureAssets) {
    this.variants = ports.scaleImage === undefined ? null : new AssetVariants(ports.scaleImage);
  }

  answer(from: string, request: PlayerAssetRequest): void {
    const { hash, maxSide } = request;
    const first = request.from ?? 0;
    const map = this.picture.map(from);
    const isMap = map?.hash === hash;
    const explored = isMap ? undefined : this.picture.explored(hash, from);
    const art = isMap || explored !== undefined ? undefined : this.picture.artPath(hash, from);
    const bytes = explored ?? (isMap || art !== undefined ? undefined : this.picture.text?.(hash, from));
    if (!isMap && bytes === undefined && art === undefined) return this.refuse(hash, from);
    const asked = maxSide === undefined ? hash : `${hash}@${maxSide}`;
    if (!this.served.take(from, request.via === undefined ? asked : `${asked}#socket`, first, this.ports.now())) return;
    if (bytes !== undefined) return this.serve(hash, bytes, from, first);
    const via = request.via;
    if (isMap) return void this.serveImage(hash, map.bytes, map.mime, from, first, maxSide, via);
    if (art !== undefined) void this.serveArt(hash, art, from, first, maxSide, via);
  }

  /** A player left, or the picture changed for all (`undefined`): requests may come again at once. */
  forget(player?: string): void {
    if (player === undefined) this.served.clear();
    else this.served.forget(player);
  }

  /** Reads artwork again and serves it while it still has the hash the player's picture names. */
  private async serveArt(hash: string, path: string, to: string, first: number, maxSide: number | undefined, via: 'socket' | undefined): Promise<void> {
    const image = await this.ports.readImage(path).catch(() => null);
    if (image === null || this.picture.artPath(hash, to) !== path || (await sha256Hex(image.bytes)) !== hash) return this.refuse(hash, to);
    await this.serveImage(hash, image.bytes, image.mime, to, first, maxSide, via);
  }

  /** The image itself, or its scaled copy for `maxSide`, while it is still in the picture once the copy is made. */
  private async serveImage(hash: string, bytes: Uint8Array, mime: string, to: string, first: number, maxSide: number | undefined, via: 'socket' | undefined): Promise<void> {
    if (maxSide === undefined) return this.deliver(hash, hash, bytes, to, first, via);
    // With a longest side asked, the original is ticketed only where it already fits: a failed scaling keeps the chunk path.
    if (this.variants === null) return (await fitsWithin(bytes, mime, maxSide)) ? this.deliver(hash, hash, bytes, to, first, via) : this.serve(hash, bytes, to, first);
    const variant = await this.variants.get(hash, bytes, mime, maxSide);
    if (!this.inPicture(hash, to)) return this.refuse(hash, to);
    if (variant === null) return (await fitsWithin(bytes, mime, maxSide)) ? this.deliver(hash, hash, bytes, to, first, via) : this.serve(hash, bytes, to, first);
    this.ports.send({ t: 'asset-variant', hash, maxSide, variant: variant.ref, width: variant.width, height: variant.height }, to);
    await this.deliver(hash, variant.ref.hash, variant.bytes, to, first, via);
  }

  /** `bytes` (the image `sent`, answering the request for `asked`) as a ticket where the player may have one, else as chunks. */
  private async deliver(asked: string, sent: string, bytes: Uint8Array, to: string, first: number, via: 'socket' | undefined): Promise<void> {
    const tickets = this.ports.tickets;
    if (tickets !== undefined && via === undefined && (this.ports.levelOf?.(to) ?? 0) >= ASSET_TICKET_LEVEL) {
      const ticket = await tickets.ticket(sent, bytes, to).catch(() => null);
      if (!this.inPicture(asked, to)) return this.refuse(asked, to);
      if (ticket !== null) return this.ports.send(ticket, to);
    }
    this.serve(sent, bytes, to, first);
  }

  private inPicture(hash: string, player: string): boolean {
    return this.picture.map(player)?.hash === hash || this.picture.artPath(hash, player) !== undefined;
  }

  private serve(hash: string, bytes: Uint8Array, to: string, first: number): void {
    for (const chunk of assetChunks(hash, bytes, first)) this.ports.send(chunk, to, assetTag(hash));
  }

  private refuse(hash: string, to: string): void {
    this.served.forget(to, hash);
    this.ports.send({ t: 'asset-refused', hash }, to);
  }
}
