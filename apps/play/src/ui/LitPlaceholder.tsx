import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';

/** Covers the stage of a lit scene while its lighting is not drawn: preparing, or (this device cannot light it) unsupported. */
export function LitPlaceholder({ unsupported }: { unsupported: boolean }): ReactElement {
  return <div className="atlas-play-lit" role="status">{t(unsupported ? 'onlinePlay.lit.unsupported' : 'onlinePlay.lit.preparing')}</div>;
}
