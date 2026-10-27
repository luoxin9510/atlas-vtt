import type { MessageKey } from '../../../../src/app/i18n/index.ts';
import { CLOSE } from '../../../../src/app/online/protocol/relay.ts';

const KEYS: Readonly<Record<number, MessageKey>> = {
  [CLOSE.badSecret]: 'onlinePlay.close.badSecret',
  [CLOSE.replaced]: 'onlinePlay.close.replaced',
  [CLOSE.full]: 'onlinePlay.close.full',
  [CLOSE.tooLarge]: 'onlinePlay.close.tooLarge',
  [CLOSE.rateLimited]: 'onlinePlay.close.rateLimited',
  [CLOSE.protocol]: 'onlinePlay.close.protocol',
  [CLOSE.version]: 'onlinePlay.close.version',
  [CLOSE.ended]: 'onlinePlay.close.ended',
  [CLOSE.kicked]: 'onlinePlay.close.kicked',
  [CLOSE.wrongCode]: 'onlinePlay.close.wrongCode',
  [CLOSE.paused]: 'onlinePlay.close.paused',
  [CLOSE.declined]: 'onlinePlay.close.declined',
  [CLOSE.noAnswer]: 'onlinePlay.close.noAnswer',
  [CLOSE.tooManyKnocks]: 'onlinePlay.close.tooManyKnocks',
  [CLOSE.noAccess]: 'onlinePlay.close.noAccess',
  [CLOSE.superseded]: 'onlinePlay.close.superseded',
  [CLOSE.badOrigin]: 'onlinePlay.close.badOrigin',
};

/** The message that tells the player why the relay closed their socket. */
export function closeReasonKey(code: number): MessageKey {
  return KEYS[code] ?? 'onlinePlay.close.other';
}

/** Whether a refused hello that carried a saved key means the key is dead (wrong code, kicked, table ended): forget it. */
export function refusedKey(code: number, hadKey: boolean): boolean {
  return hadKey && (code === CLOSE.wrongCode || code === CLOSE.kicked || code === CLOSE.ended);
}
