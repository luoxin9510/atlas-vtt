import type { ReactElement } from 'react';
import type { AssetRef } from '../../../../src/app/online/protocol/asset.ts';
import { useAssetUrl, type Loader } from '../assets/useAssetUrl.ts';

/** Longest side of a note's picture asked for. */
export const NOTE_IMAGE_SIDE = 1280;

export interface NoteImageProps {
  assetRef: AssetRef;
  alt: string;
  assets: Loader;
}

/** A picture the GM's copy names by hash: fetched through the asset loader, shown from an object URL that is revoked on unmount. Nothing until it has arrived. */
export function NoteImage({ assetRef, alt, assets }: NoteImageProps): ReactElement | null {
  const src = useAssetUrl(assets, assetRef, NOTE_IMAGE_SIDE);
  return src === null ? null : <img className="atlas-play-note-image" src={src} alt={alt} />;
}
