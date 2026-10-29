import { t } from '../../../i18n';
import type { ImageCacheReason } from '../assetUpload/uploadAsset.ts';

/** The whole sentence for one reason (one key each, never joined from fragments). It names no URL, hash, code or file. */
export function imageCacheText(reason: ImageCacheReason): string {
  switch (reason) {
    case 'full':
      return t('onlineDock.imageCache.full');
    case 'busy':
      return t('onlineDock.imageCache.busy');
    case 'refused':
      return t('onlineDock.imageCache.refused');
    case 'unreachable':
      return t('onlineDock.imageCache.unreachable');
  }
}

/** Under a surface's header while the relay's image cache cannot take images, so they go to players over the socket: why. */
export function renderImageCacheRow(layer: HTMLElement, reason: ImageCacheReason | null): void {
  if (reason === null) return;
  const row = layer.createDiv({ cls: 'atlas-online-image-row', attr: { role: 'status' } });
  row.createSpan({ cls: 'atlas-online-image-row__text', text: imageCacheText(reason) });
}
