import { useEffect, useState } from 'react';
import type { AssetRef } from '../../../../src/app/online/protocol/asset.ts';
import type { AssetLoader, ReconnectSignal } from './AssetLoader.ts';

export type Loader = Pick<AssetLoader, 'load'> & ReconnectSignal;

/** An object URL of an asset (at most `maxSide` on its longest side), revoked when the asset changes or the component goes. Null until loaded or when it fails. */
export function useAssetUrl(assets: Loader, ref: AssetRef | null, maxSide: number): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const hash = ref?.hash;
  useEffect(() => {
    if (ref === null) return undefined;
    let url: string | null = null;
    let cancelled = false;
    let stopWaiting: (() => void) | null = null;
    // A failed load waits for the connection to come back and asks once more; each further failure waits for the next reconnect.
    const failed = (): void => {
      if (cancelled || stopWaiting !== null) return;
      stopWaiting = assets.onReconnect?.(() => { stopWaiting?.(); stopWaiting = null; start(); }) ?? null;
    };
    const start = (): void => {
      void assets.load(ref, maxSide).then((loaded) => {
        if (cancelled) return;
        if (loaded === null) return failed();
        url = URL.createObjectURL(new Blob([loaded.bytes as BlobPart], { type: loaded.mime }));
        setSrc(url);
      }).catch(failed); // No picture: the caller keeps its placeholder.
    };
    start();
    return () => {
      cancelled = true;
      stopWaiting?.();
      if (url !== null) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [assets, hash, maxSide]);
  return src;
}
