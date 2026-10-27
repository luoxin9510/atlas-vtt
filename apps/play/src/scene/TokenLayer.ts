import { Container, Texture } from 'pixi.js';
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

interface Entry { view: TokenView; art: string | null }

/** The tokens the GM shared, one container each, moved in place as the list changes and drawn in list order. */
export class TokenLayer {
  readonly container = new Container({ label: 'token-layer', eventMode: 'none' });
  private readonly entries = new Map<string, Entry>();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private tokens: readonly SharedToken[] = [];
  private destroyed = false;

  constructor(private readonly assets: Pick<AssetLoader, 'load'>, private readonly lowPower: boolean) {}

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
        entry = { view: new TokenView(token.id), art: null };
        this.entries.set(token.id, entry);
        this.container.addChild(entry.view.root);
      }
      entry.view.update(token, mine.has(token.id), selected === token.id, cell > 0 ? restingTokenUIScale(cell) : tokenUIScale(token.size));
      if (this.container.children[index] !== entry.view.root) this.container.setChildIndex(entry.view.root, index);
      this.showArt(entry, token);
    });
  }

  containerOf(id: string): Container | undefined {
    return this.entries.get(id)?.view.root;
  }

  tokenAt(worldX: number, worldY: number, accept?: (token: SharedToken) => boolean): string | null {
    return hitOrder(this.tokens, worldX, worldY, accept);
  }

  private showArt(entry: Entry, token: SharedToken): void {
    const hash = token.art?.hash ?? null;
    if (hash === entry.art) return;
    entry.art = hash;
    if (token.art === null) return;
    void this.texture(token.art).then((texture) => {
      if (texture === null || this.destroyed || entry.art !== hash) return;
      entry.view.setArt(texture, this.tokens.find((t) => t.id === token.id)?.size ?? token.size);
    });
  }

  private texture(ref: AssetRef): Promise<Texture | null> {
    let texture = this.textures.get(ref.hash);
    if (!texture) {
      texture = this.assets.load(ref, TOKEN_ART_MAX_SIDE).then(async (asset) => {
        if (asset === null) return null;
        try {
          const made = Texture.from(await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime })));
          made.source.autoGenerateMipmaps = !this.lowPower;
          return made;
        } catch {
          return null;
        }
      });
      this.textures.set(ref.hash, texture);
    }
    return texture;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entry of this.entries.values()) entry.view.destroy();
    this.entries.clear();
    for (const pending of this.textures.values()) void pending.then((texture) => texture?.destroy(true));
    this.textures.clear();
    this.container.destroy();
  }
}
