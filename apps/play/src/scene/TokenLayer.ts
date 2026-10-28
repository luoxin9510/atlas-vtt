import { Container, ImageSource, Texture } from 'pixi.js';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import type { AssetRef } from '../../../../src/app/online/protocol/asset.ts';
import { restingTokenUIScale, tokenUIScale } from '../../../../src/app/pixi/token-renderer/tokenSizing.ts';
import type { AssetLoader } from '../assets/AssetLoader.ts';
import { TokenView } from './tokenSprite.ts';

/** Token artwork is asked for at most this long a side. */
export const TOKEN_ART_MAX_SIDE = 512;

/**
 * The topmost token whose disc holds the world point: the last in the list, as the list is the draw order.
 * `accept` lets the caller pass over tokens it must not hit (those under fog).
 */
export function hitOrder(tokens: readonly SharedToken[], x: number, y: number, accept: (token: SharedToken) => boolean = () => true): string | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (Math.hypot(x - token.x, y - token.y) <= token.size / 2 && accept(token)) return token.id;
  }
  return null;
}

interface Entry { view: TokenView; art: string | null; shown: boolean }
interface CachedArt { texture: Promise<Texture | null>; bitmap: ImageBitmap | null; failedAt?: number }

/** A failed art load is tried again no sooner than this. */
const RETRY_MS = 10_000;

function releaseArt(art: CachedArt): void {
  void art.texture.then((texture) => {
    texture?.destroy(true);
    art.bitmap?.close();
  });
}

/** The tokens the GM shared, one container each, moved in place as the list changes and drawn in list order. */
export class TokenLayer {
  readonly container = new Container({ label: 'token-layer', eventMode: 'none' });
  private readonly entries = new Map<string, Entry>();
  private readonly textures = new Map<string, CachedArt>();
  private tokens: readonly SharedToken[] = [];
  private destroyed = false;

  constructor(private readonly assets: Pick<AssetLoader, 'load'>, private readonly lowPower: boolean, private readonly now: () => number = () => Date.now()) {}

  /** `cell`: the grid cell in world pixels, which sets the size of bars and nameplates; 0 sizes them by the token. */
  sync(tokens: readonly SharedToken[], mine: ReadonlySet<string>, selected: string | null, cell = 0): void {
    if (this.destroyed) return;
    this.tokens = tokens;
    const keep = new Set(tokens.map((token) => token.id));
    for (const [id, entry] of this.entries) {
      if (keep.has(id)) continue;
      entry.view.destroy();
      this.entries.delete(id);
    }
    tokens.forEach((token, index) => {
      let entry = this.entries.get(token.id);
      if (!entry) {
        entry = { view: new TokenView(token.id), art: null, shown: false };
        this.entries.set(token.id, entry);
        this.container.addChild(entry.view.root);
      }
      entry.view.update(token, mine.has(token.id), selected === token.id, cell > 0 ? restingTokenUIScale(cell) : tokenUIScale(token.size));
      if (this.container.children[index] !== entry.view.root) this.container.setChildIndex(entry.view.root, index);
      this.showArt(entry, token);
    });
    this.sweep(new Set(tokens.flatMap((token) => (token.art ? [token.art.hash] : []))));
  }

  containerOf(id: string): Container | undefined {
    return this.entries.get(id)?.view.root;
  }

  tokenAt(worldX: number, worldY: number, accept?: (token: SharedToken) => boolean): string | null {
    return hitOrder(this.tokens, worldX, worldY, accept);
  }

  private showArt(entry: Entry, token: SharedToken): void {
    const hash = token.art?.hash ?? null;
    if (hash !== entry.art) {
      entry.art = hash;
      entry.shown = false;
      entry.view.clearArt();
    }
    if (token.art === null || entry.shown) return;
    const cached = this.textures.get(token.art.hash);
    if (cached?.failedAt !== undefined && this.now() - cached.failedAt >= RETRY_MS) this.textures.delete(token.art.hash);
    void this.texture(token.art).then((texture) => {
      if (texture === null || this.destroyed || entry.art !== hash || entry.shown) return;
      entry.shown = true;
      entry.view.setArt(texture, this.tokens.find((t) => t.id === token.id)?.size ?? token.size);
    });
  }

  private texture(ref: AssetRef): Promise<Texture | null> {
    let cached = this.textures.get(ref.hash);
    if (!cached) {
      const made: CachedArt = { texture: Promise.resolve(null), bitmap: null };
      made.texture = this.assets.load(ref, TOKEN_ART_MAX_SIDE).then(async (asset) => {
        if (asset === null) return this.failed(made);
        try {
          const bitmap = await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
          made.bitmap = bitmap;
          return new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: !this.lowPower }) });
        } catch {
          made.bitmap?.close();
          made.bitmap = null;
          return this.failed(made);
        }
      });
      this.textures.set(ref.hash, made);
      cached = made;
    }
    return cached.texture;
  }

  private failed(art: CachedArt): null {
    art.failedAt = this.now();
    return null;
  }

  /** Frees the art of hashes no listed token uses. */
  private sweep(used: ReadonlySet<string>): void {
    for (const [hash, art] of this.textures) {
      if (used.has(hash)) continue;
      this.textures.delete(hash);
      releaseArt(art);
    }
  }

  /** The texture a token's view shows, or null on the neutral disc; for tests. */
  artOf(id: string): Texture | null {
    return this.entries.get(id)?.view.artTexture() ?? null;
  }

  /** The hashes whose art is held; for tests. */
  cachedArt(): string[] {
    return [...this.textures.keys()];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entry of this.entries.values()) entry.view.destroy();
    this.entries.clear();
    for (const art of this.textures.values()) releaseArt(art);
    this.textures.clear();
    this.container.destroy();
  }
}
