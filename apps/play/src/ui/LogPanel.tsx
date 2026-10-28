import { useMemo, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { t } from '../../../../src/app/i18n/index.ts';
import { TableLogPanel, type LogActions, type SpeakerOption } from '../../../../src/app/online/tableLog/index.ts';
import type { Session } from '../app/session.ts';

export interface LogPanelProps {
  session: Session;
  actions: LogActions;
  canSend: boolean;
}

/** The shared log and chat panel, filling the dock; the viewer may speak as themselves or as one of their tokens. */
export function LogPanel({ session, actions, canSend }: LogPanelProps): ReactElement {
  const { store, log } = session;
  const self = useStore(store, (state) => state.self);
  const tokens = useStore(store, (state) => state.tokens);
  const mine = useStore(store, (state) => state.mine);
  const speakers = useMemo<readonly SpeakerOption[]>(() => {
    const own = tokens.filter((token) => mine.has(token.id));
    return [
      { key: 'self', name: t('onlinePlay.players.you'), kind: 'self', portrait: null },
      ...own.map((token): SpeakerOption => ({ key: token.id, name: token.name ?? t('onlinePlay.token.unnamed'), kind: 'token', portrait: null })),
    ];
  }, [tokens, mine]);
  return (
    <TableLogPanel
      state={log} actions={actions} self={self} moderator={false} canSend={canSend}
      offlineText={t('onlinePlay.log.offline')} speakers={speakers} variant="embedded" onClose={() => undefined}
    />
  );
}
