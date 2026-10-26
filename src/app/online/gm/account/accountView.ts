import type { AccessRefusal, AccountAnswer, AccountInfo, HostAccess } from './relayAccount.ts';
import { t } from '../../../i18n';

/**
 * What the dock and the settings show of the GM's account, as pure rules. The GM signs in with an
 * Atlas account, and the relay says what it may host or why it may not: nothing here decides that.
 */

/** A line that tells the GM why they are signed out. */
export type SignedOutNotice = 'timed-out' | 'declined' | 'server' | 'unreachable' | null;

export type AccountView =
  | { readonly kind: 'signed-out'; readonly notice: SignedOutNotice }
  /** The sign-in waits for approval in the browser; the code is null until the service gave one. */
  | { readonly kind: 'waiting'; readonly userCode: string | null }
  | { readonly kind: 'checking' }
  /** A self-hosted server has no account: only whether a host key is kept. */
  | { readonly kind: 'host-key'; readonly set: boolean }
  | { readonly kind: 'unreachable' }
  /** The relay says the account may not host; `reason` is null for one this version does not know. */
  | { readonly kind: 'no-access'; readonly account: AccountInfo; readonly reason: AccessRefusal | null }
  | { readonly kind: 'can-host'; readonly account: AccountInfo; readonly access: HostAccess };

/** What the account control knows when it decides what to show. */
export interface AccountFacts {
  readonly signingIn: boolean;
  readonly userCode: string | null;
  readonly token: boolean;
  /** Whether the server is a self-hosted one, where `token` is the host key. */
  readonly selfHosted: boolean;
  /** The last answer of `/api/me` for this token; null until one came. */
  readonly me: AccountAnswer | 'unreachable' | null;
  readonly notice: SignedOutNotice;
}

export function accountView(facts: AccountFacts): AccountView {
  if (facts.selfHosted) return { kind: 'host-key', set: facts.token };
  if (facts.signingIn) return { kind: 'waiting', userCode: facts.userCode };
  if (!facts.token) return { kind: 'signed-out', notice: facts.notice };
  if (facts.me === null) return { kind: 'checking' };
  if (facts.me === 'unreachable') return { kind: 'unreachable' };
  const { account } = facts.me;
  return facts.me.access === null ? { kind: 'no-access', account, reason: facts.me.reason } : { kind: 'can-host', account, access: facts.me.access };
}

const ACCESS_TEXT: Readonly<Record<AccessRefusal, string>> = {
  'no-access': t('onlineGm.access.noAccess'),
  'access-ended': t('onlineGm.access.ended'),
  'access-revoked': t('onlineGm.access.revoked'),
  'account-restricted': t('onlineGm.access.restricted'),
  'terms-not-accepted': t('onlineGm.access.termsNotAccepted'),
};

/** What is said of an account that may not host, whatever the reason. */
export const NO_HOSTING_TEXT = t('onlineGm.access.noHosting');

/** Why the relay says the account may not host, and where the way on is: the account page. */
export const accessText = (reason: AccessRefusal | null): string => (reason === null ? t('onlineGm.access.noHostingSee') : ACCESS_TEXT[reason]);

export const HOST_KEY_SET_TEXT = t('onlineGm.hostKey.set');
export const NO_HOST_KEY_TEXT = t('onlineGm.hostKey.none');
export const HOST_KEY_REFUSED_TEXT = t('onlineGm.hostKey.refused');

export const UNREACHABLE_TEXT = t('onlineGm.account.unreachable');
export const SERVER_SIGNED_OUT_TEXT = t('onlineGm.account.serverSignedOut');

/** The line under the sign-in button that says how the last sign-in ended. */
export function noticeText(notice: SignedOutNotice): string | null {
  switch (notice) {
    case 'timed-out': return t('onlineGm.account.timedOut');
    case 'declined': return t('onlineGm.account.declined');
    case 'server': return SERVER_SIGNED_OUT_TEXT;
    case 'unreachable': return UNREACHABLE_TEXT;
    default: return null;
  }
}

const PLAN_NAMES: Readonly<Record<string, string>> = { beta: t('onlineGm.plan.beta'), free: t('onlineGm.plan.free'), host: t('onlineGm.plan.host'), staff: t('onlineGm.plan.staff') };

/** The plan in words: "Early access · up to 12 players". */
export function planText(access: HostAccess): string {
  const players = t('onlineGm.plan.players', { count: access.maxPlayers });
  return t('onlineGm.plan.upTo', { plan: PLAN_NAMES[access.plan] ?? access.plan, players });
}

/** "Mara (@mara)", or the handle alone where the name is the handle. */
export function accountText(account: AccountInfo): string {
  return account.name === '' || account.name === account.handle ? `@${account.handle}` : `${account.name} (@${account.handle})`;
}
