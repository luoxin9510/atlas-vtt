import type { ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import type { SocketStatus } from '../net/TableSocket.ts';

export interface StatusBarProps {
  status: SocketStatus;
  ownCode: string | null;
  onSettings(): void;
}

const spaced = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** The connection, the "GM offline" banner while the GM is away, the own code, and the settings button. */
export function StatusBar({ status, ownCode, onSettings }: StatusBarProps): ReactElement {
  const label = status.kind === 'joined' ? t('onlinePlay.status.connected')
    : status.kind === 'retrying' ? t('onlinePlay.status.retrying')
      : t('onlinePlay.status.connecting');
  const gmOffline = status.kind === 'joined' && !status.gmOnline;
  return (
    <header className="atlas-play-status">
      <div className="atlas-play-status-row">
        <span className={`atlas-play-dot atlas-play-dot-${status.kind}`} aria-hidden="true" />
        <span role="status">{label}</span>
        <button type="button" onClick={onSettings} aria-label={t('onlinePlay.settings.open')}>⚙</button>
      </div>
      {gmOffline ? <p className="atlas-play-banner" role="alert">{t('onlinePlay.status.gmOffline')}</p> : null}
      {ownCode !== null ? <p className="atlas-play-own-code">{t('onlinePlay.own.code', { code: spaced(ownCode) })}</p> : null}
    </header>
  );
}
