import type { SecretEntry } from '../protocol/index.ts';
import { EyeOff } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import { shownName } from './logAuthors.ts';
import { t } from '../../i18n';

export interface SecretRowProps {
  readonly entry: SecretEntry;
  readonly self: string | null;
  readonly time: string;
}

/** What a private roll's line says: the viewer's own blind roll tells them who sees it, anyone else's only that it was made. */
export function secretText(entry: SecretEntry, self: string | null): string {
  if (self !== null && entry.who === self) return entry.mode === 'blind' ? t('onlineLog.secret.blind') : t('onlineLog.secret.self');
  const roller = shownName(entry.who, entry.name, self);
  const by = entry.speaker === undefined ? roller : `${entry.speaker.name} (${roller})`;
  return t('onlineLog.secret.other', { by });
}

/** A private roll the viewer is not shown: one quiet line in its place. */
export const SecretRow = memo(function SecretRow({ entry, self, time }: SecretRowProps): ReactElement {
  return (
    <div className="atlas-online-log__secret">
      <EyeOff />
      <span className="atlas-online-log__secret-text">{secretText(entry, self)}</span>
      <span className="atlas-online-log__time">{time}</span>
    </div>
  );
});
