import { useSyncExternalStore, type ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import { GM_AUTHOR } from '../../../../src/app/online/protocol/chat.ts';
import type { LogState } from '../../../../src/app/online/tableLog/index.ts';

export interface PlayersPanelProps {
  log: LogState;
  self: string | null;
  gmOnline: boolean;
}

/** Who is at the table: the GM first, players who left dimmed, the viewer marked. */
export function PlayersPanel({ log, self, gmOnline }: PlayersPanelProps): ReactElement {
  const { people } = useSyncExternalStore(log.subscribe, log.snapshot);
  const gm = people.find((person) => person.id === GM_AUTHOR);
  const rows = [
    { id: GM_AUTHOR, name: gm?.name ?? t('onlinePlay.players.gm'), away: !gmOnline },
    ...people.filter((person) => person.id !== GM_AUTHOR).map((person) => ({ id: person.id, name: person.name, away: person.away === true })),
  ];
  return (
    <ul className="atlas-play-players" aria-label={t('onlinePlay.tab.players')}>
      {rows.map((row) => (
        <li key={row.id} className={row.away ? 'atlas-play-away' : undefined}>
          <span>{row.name}</span>
          {row.id === GM_AUTHOR ? <small>{t('onlinePlay.players.gm')}</small> : null}
          {row.id === self ? <strong>{t('onlinePlay.players.you')}</strong> : null}
          {row.away ? <small>{t('onlinePlay.players.away')}</small> : null}
        </li>
      ))}
    </ul>
  );
}
