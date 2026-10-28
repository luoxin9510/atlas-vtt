import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';

export const SOURCE_URL = 'https://github.com/luoxin9510/atlas-vtt';
export const LICENCE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** AGPL-3.0 section 13: where the running software's source and licence are. */
export function LegalLinks(): ReactElement {
  return (
    <nav className="atlas-play-legal">
      <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">{t('onlinePlay.legal.source')}</a>
      <a href={LICENCE_URL} target="_blank" rel="noreferrer noopener">{t('onlinePlay.legal.licence')}</a>
    </nav>
  );
}
