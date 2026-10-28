import { useEffect, useState } from 'react';
import type { AssetRef } from '../../../../src/app/online/protocol/asset.ts';
import type { AssetLoader } from './AssetLoader.ts';

export type Loader = Pick<AssetLoader, 'load'>;

/** An object URL of an asset (at most `maxSide` on its longest side), revoked when the asset changes or the component goes. Null until loaded or when it fails. */
export function useAssetUrl(assets: Loader, ref: AssetRef | null, maxSide: number): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const hash = ref?.hash;
  useEffect(() => {
    if (ref === null) return undefined;
    let url: string | null = null;
    let cancelled = false;
    void assets.load(ref, maxSide).then((loaded) => {
      if (cancelled || loaded === null) return;
      url = URL.createObjectURL(new Blob([loaded.bytes as BlobPart], { type: loaded.mime }));
      setSrc(url);
    }).catch(() => undefined); // No picture: the caller keeps its placeholder.
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [assets, hash, maxSide]);
  return src;
}
