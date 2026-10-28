import type { AssetRef } from '../../../../src/app/online/protocol/index.ts';
import type { AssetLoader, LoadedAsset } from '../assets/AssetLoader.ts';

/** A failed map download is tried again after this long, if the connection did not come back sooner. */
export const MAP_RETRY_MS = 10_000;

export interface MapWish {
  readonly ref: AssetRef;
  readonly maxSide: number;
}

export interface MapDownloadPorts {
  assets: Pick<AssetLoader, 'load' | 'cancel'>;
  /** The map arrived (for the key it was asked for). */
  arrived(key: string, asset: LoadedAsset): void;
  setTimer(run: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

/**
 * Asks for the map of the scene shown and keeps asking while it fails: a download lost with the
 * connection is asked for again once the table is back (or after `MAP_RETRY_MS`). A scene that
 * changes, or turns lit, gives the download up and stops all asking for it.
 */
export class MapDownload {
  private key: string | null = null;
  private wish: MapWish | null = null;
  private failed = false;
  private wasConnected = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ports: MapDownloadPorts) {}

  /** `key`: the scene and map shown (null: none); `wish`: the map wanted for it (null: none to ask for). */
  sync(key: string | null, wish: MapWish | null, connected: boolean): void {
    if (key !== this.key) {
      this.stop();
      this.key = key;
      this.wish = wish;
      this.wasConnected = connected;
      this.start();
      return;
    }
    if (this.failed && connected && !this.wasConnected) this.start();
    this.wasConnected = connected;
  }

  /** Gives up the download in flight and any retry. */
  stop(): void {
    this.generation += 1;
    this.failed = false;
    if (this.timer !== null) this.ports.clearTimer(this.timer);
    this.timer = null;
    if (this.wish !== null) this.ports.assets.cancel(this.wish.ref.hash);
    this.wish = null;
    this.key = null;
  }

  private start(): void {
    const { wish, key } = this;
    if (wish === null || key === null) return;
    if (this.timer !== null) this.ports.clearTimer(this.timer);
    this.timer = null;
    this.failed = false;
    this.generation += 1;
    const generation = this.generation;
    void this.ports.assets.load(wish.ref, wish.maxSide).then((asset) => {
      if (generation !== this.generation) return;
      if (asset !== null) {
        this.ports.arrived(key, asset);
        return;
      }
      this.failed = true;
      this.timer = this.ports.setTimer(() => {
        this.timer = null;
        if (generation === this.generation) this.start();
      }, MAP_RETRY_MS);
    });
  }
}
