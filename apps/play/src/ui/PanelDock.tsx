import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { t, type MessageKey } from '../../../../src/app/i18n/index.ts';
import type { Session } from '../app/session.ts';
import { DiceTray } from './DiceTray.tsx';
import { InitiativePanel } from './InitiativePanel.tsx';
import { sessionActions } from './logActions.ts';
import { LogPanel } from './LogPanel.tsx';
import { PlayersPanel } from './PlayersPanel.tsx';
import './panels.scss';

type Tab = 'log' | 'dice' | 'initiative' | 'players';
const TABS: readonly { tab: Tab; label: MessageKey }[] = [
  { tab: 'log', label: 'onlinePlay.tab.log' },
  { tab: 'dice', label: 'onlinePlay.tab.dice' },
  { tab: 'initiative', label: 'onlinePlay.tab.initiative' },
  { tab: 'players', label: 'onlinePlay.tab.players' },
];

export interface PanelDockProps {
  session: Session;
}

/** The tabs and their panel: a bottom sheet on a phone, a side panel on wide screens. Closed until a tab is tapped (again to close). */
export function PanelDock({ session }: PanelDockProps): ReactElement {
  const { store, log } = session;
  const [open, setOpen] = useState<Tab | null>(null);
  const status = useStore(store, (state) => state.status);
  const scene = useStore(store, (state) => state.scene);
  const initiative = useStore(store, (state) => state.initiative);
  const refusal = useStore(store, (state) => state.rollRefusal);
  const self = useStore(store, (state) => state.self);
  const [sendFailed, setSendFailed] = useState(false);
  const actions = useMemo(() => sessionActions(session, (ok) => setSendFailed(!ok)), [session]);
  const unread = useSyncExternalStore(log.subscribe, () => log.snapshot().unread);
  useEffect(() => {
    log.setOpen(open === 'log');
  }, [log, open]);
  const gmOnline = status.kind === 'joined' && status.gmOnline;
  const canSend = status.kind === 'joined' && gmOnline;
  return (
    <section className="atlas-play-dock" aria-label={t('onlinePlay.dock.label')}>
      <div className="atlas-play-tabs" role="tablist">
        {TABS.map(({ tab, label }) => (
          <button key={tab} type="button" role="tab" aria-selected={open === tab} onClick={() => { setSendFailed(false); setOpen(open === tab ? null : tab); }}>
            {t(label)}
            {tab === 'log' && unread > 0 ? <span className="atlas-play-unread" aria-label={t('onlinePlay.log.unread', { count: unread })}>{unread}</span> : null}
          </button>
        ))}
      </div>
      {sendFailed ? <p className="atlas-play-reason" role="alert">{t('onlinePlay.send.failed')}</p> : null}
      {open !== null ? (
        <div className="atlas-play-panel" role="tabpanel">
          {open === 'log' ? <LogPanel session={session} actions={actions} canSend={canSend} /> : null}
          {open === 'dice' ? (
            <DiceTray
              log={log} canRoll={canSend && scene !== null} refusal={refusal}
              onRoll={(formula, mode) => {
                store.clearRollRefusal();
                actions.roll({ formula, mode });
              }}
              onClearRefusal={() => store.clearRollRefusal()}
            />
          ) : null}
          {open === 'initiative' ? <InitiativePanel initiative={initiative} assets={session.assets} /> : null}
          {open === 'players' ? <PlayersPanel log={log} self={self} gmOnline={gmOnline} /> : null}
        </div>
      ) : null}
    </section>
  );
}
