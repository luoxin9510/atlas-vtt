import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';

/** Shown instead of the picture of a lit scene (dynamic lighting comes in a later version). */
export function LitPlaceholder(): ReactElement {
  return <div className="atlas-play-lit" role="status">{t('onlinePlay.lit.placeholder')}</div>;
}
