import type { AssetRef } from '../../../../src/app/online/protocol/index.ts';
import type { AssetLoader, ReconnectSignal } from '../assets/AssetLoader.ts';
import { dataUrlOfPng } from './pngDataUrl.ts';

/**
 * The remembered-areas mask of a lit scene: a PNG fetched once per reference and handed to `set` as a
 * data URL. `set` only ever gets the url the loader returned for the current reference, or null (fail
 * closed: the player sees less, never an old mask the GM may have erased). A reference whose load
 * answered null is asked for again once the connection is back; a loaded mask never is.
 */
export class ExploredMask {
  private ref: AssetRef | null = null;
  private loaded = false;
  private request = 0;
  private destroyed = false;
  private readonly stopListening: (() => void) | null;

  constructor(
    private readonly assets: Pick<AssetLoader, 'load'> & ReconnectSignal,
    private readonly set: (url: string | null) => void,
  ) {
    this.stopListening = assets.onReconnect?.(() => this.retry()) ?? null;
  }

  follow(ref: AssetRef | null): void {
    if (this.destroyed || ref?.hash === this.ref?.hash) return;
    this.ref = ref;
    this.loaded = false;
    this.request += 1;
    // The old mask may hold areas the GM has erased: show none while the new one loads.
    this.set(null);
    if (ref !== null) this.fetch(ref);
  }

  private retry(): void {
    if (this.destroyed || this.ref === null || this.loaded) return;
    this.request += 1;
    this.fetch(this.ref);
  }

  private fetch(ref: AssetRef): void {
    const mine = this.request;
    const current = (): boolean => !this.destroyed && this.request === mine;
    void this.assets.load(ref, null).then((asset) => {
      if (!current()) return;
      this.loaded = asset !== null;
      this.set(asset === null ? null : dataUrlOfPng(asset.bytes));
    }, () => {
      if (current()) this.set(null);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopListening?.();
  }
}
