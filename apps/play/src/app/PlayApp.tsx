import { useState, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { t } from '../../../../src/app/i18n/index.ts';
import { saveLanguageChoice, type LanguageChoice } from '../../../../src/app/i18n/languageChoice.ts';
import { closeReasonKey } from '../net/closeReasons.ts';
import { saveLowPower } from '../scene/lowPower.ts';
import { AppShell } from '../ui/AppShell.tsx';
import { JoinScreen } from '../ui/JoinScreen.tsx';
import { LegalLinks } from '../ui/LegalLinks.tsx';
import { SceneCanvas } from '../ui/SceneCanvas.tsx';
import { PanelDock } from '../ui/PanelDock.tsx';
import { SettingsSheet } from '../ui/SettingsSheet.tsx';
import { StatusBar } from '../ui/StatusBar.tsx';
import { YourTurnBanner } from '../ui/YourTurnBanner.tsx';
import type { Session } from './session.ts';

export interface PlayAppProps {
  /** Null when the page's address holds no valid table code. */
  session: Session | null;
  language: string;
  lowPower: boolean;
  storage: Storage | null;
  reload(): void;
  /** False where `crypto.subtle` is missing (a page opened over plain http): assets could not be verified, so nothing is joined. Default true. */
  secure?: boolean;
}

function Table({ session, language, lowPower: initialLowPower, storage, reload }: PlayAppProps & { session: Session }): ReactElement {
  const status = useStore(session.store, (state) => state.status);
  const ownCode = useStore(session.store, (state) => state.ownCode);
  const name = useStore(session.view, (state) => state.name);
  const [lowPower, setLowPower] = useState(initialLowPower);
  const [settings, setSettings] = useState(false);
  const onLanguage = (choice: LanguageChoice): void => {
    saveLanguageChoice(storage, choice);
    reload();
  };
  if (status.kind === 'refused') {
    return (
      <div className="atlas-play-join">
        <p className="atlas-play-reason" role="alert">{t(closeReasonKey(status.code))}</p>
        <button type="button" onClick={() => session.backToForm()}>{t('onlinePlay.join.retry')}</button>
        <LegalLinks />
      </div>
    );
  }
  if (status.kind === 'waiting') {
    return <div className="atlas-play-join"><p role="status">{t('onlinePlay.join.waiting')}</p><LegalLinks /></div>;
  }
  return (
    <div className="atlas-play-table">
      <StatusBar status={status} ownCode={ownCode} onSettings={() => setSettings(true)} />
      {status.kind === 'connecting' && name !== '' ? <p className="atlas-play-welcome">{t('onlinePlay.join.back', { name })}</p> : null}
      <SceneCanvas store={session.store} assets={session.assets} lowPower={lowPower} />
      <YourTurnBanner store={session.store} lowPower={lowPower} />
      <PanelDock session={session} />
      {settings ? (
        <SettingsSheet
          language={language} lowPower={lowPower} ownCode={ownCode} onLanguage={onLanguage}
          onLowPower={(on) => { setLowPower(on); saveLowPower(storage, on); }}
          onClose={() => setSettings(false)}
        />
      ) : null}
    </div>
  );
}

function Screens(props: PlayAppProps & { session: Session }): ReactElement {
  const { session } = props;
  const view = useStore(session.view, (state) => state);
  return view.screen === 'form'
    ? <JoinScreen name={view.name} reason={view.reason === null ? null : t(view.reason)} onJoin={(as) => session.join(as)} />
    : <Table {...props} />;
}

/** Picks the screen: no table link, the join form, or the table. */
export function PlayApp(props: PlayAppProps): ReactElement {
  const { session, secure = true } = props;
  if (!secure) return <AppShell><p role="alert">{t('onlinePlay.app.insecure')}</p><LegalLinks /></AppShell>;
  return <AppShell>{session === null ? <><p>{t('onlinePlay.app.noTable')}</p><LegalLinks /></> : <Screens {...props} session={session} />}</AppShell>;
}
