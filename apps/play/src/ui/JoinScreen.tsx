import { useState, type FormEvent, type ReactElement } from 'react';
import { t } from '../../../../src/app/i18n/index.ts';
import { JOIN_CODE_PATTERN, playerName } from '../../../../src/app/online/protocol/identity.ts';
import type { JoinAs } from '../net/TableSocket.ts';
import { LegalLinks } from './LegalLinks.tsx';

export interface JoinScreenProps {
  /** The name to start with (a player coming back to the form). */
  name?: string;
  /** Why the player is at the form again, already translated. */
  reason?: string | null;
  onJoin(as: JoinAs): void;
}

/** The form: a name and one 6-digit field that takes the table's join code or the player's own code. */
export function JoinScreen({ name: initialName = '', reason = null, onJoin }: JoinScreenProps): ReactElement {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const shown = playerName(name);
  const valid = shown !== null && (code === '' || JOIN_CODE_PATTERN.test(code));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (valid) onJoin(code === '' ? { name: shown } : { name: shown, code });
  };
  return (
    <form className="atlas-play-join" onSubmit={submit}>
      <h1>{t('onlinePlay.join.title')}</h1>
      {reason !== null ? <p className="atlas-play-reason" role="alert">{reason}</p> : null}
      <label>
        <span>{t('onlinePlay.join.name')}</span>
        <input type="text" value={name} autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>{t('onlinePlay.join.code')}</span>
        <input
          type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </label>
      <button type="submit" disabled={!valid}>{t('onlinePlay.join.submit')}</button>
      <LegalLinks />
    </form>
  );
}
