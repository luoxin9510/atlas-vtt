import type { Timers } from '../companionTimers.ts';
import { accountPageUrl, accountsOrigin, isSelfHosted, relayOrigin } from '../servers.ts';
import { accountView, SERVER_SIGNED_OUT_TEXT, type AccountFacts, type AccountView, type SignedOutNotice } from './accountView.ts';
import { DeviceSignIn } from './deviceFlow.ts';
import type { Http } from './http.ts';
import { RelayAccount, signOutToken, type AccountAnswer } from './relayAccount.ts';
import type { TokenStore } from './tokenStore.ts';
import { t } from '../../../i18n';

export interface AccountPorts {
  readonly http: Http;
  readonly timers: Timers;
  readonly tokens: TokenStore;
  /** The host key of a self-hosted server, kept like the token. */
  readonly hostKeys: TokenStore;
  readonly openUrl: (url: string) => void;
  /** Tells the GM something outside the dock (Obsidian's `Notice`). */
  readonly notify: (text: string) => void;
}

/** The part of the account control the dock uses. */
export type AccountApi = Pick<AccountControl, 'view' | 'onChange' | 'refresh' | 'signIn' | 'cancelSignIn' | 'reopenSignIn' | 'signOut' | 'openAccountPage'>;

/** How long an answer of `/api/me` is fresh enough that opening the dock does not ask again. */
const FRESH_MS = 10_000;

/**
 * The GM's Atlas account: device sign-in, the token in secret storage, what `/api/me` says it may
 * host or why it may not, and sign-out. Invite keys are redeemed and the account's data is exported
 * and deleted on the website's account page, never here. A 401 anywhere clears the token and says
 * so; tables already running never depend on it. The dock and the settings read `view()`.
 * On a self-hosted server there is no account: the host key stands in for the token, is sent only with
 * the table request, and none of the account calls are made.
 */
export class AccountControl {
  private readonly ports: AccountPorts;
  private flow: DeviceSignIn | null = null;
  private userCode: string | null = null;
  private me: AccountAnswer | 'unreachable' | null = null;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private checking: Promise<void> | null = null;
  private notice: SignedOutNotice = null;
  private readonly listeners = new Set<() => void>();

  constructor(ports: AccountPorts) {
    this.ports = ports;
  }

  view(): AccountView {
    return accountView(this.facts());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The token tables are asked for with (a self-hosted server's host key), or null while there is none. */
  token(): string | null {
    return isSelfHosted() ? this.ports.hostKeys.get() : this.ports.tokens.get();
  }

  /** Keeps the host key of a self-hosted server (blank: forgets it); the GM is told where Obsidian has no secure storage. */
  setHostKey(key: string): void {
    const trimmed = key.trim();
    try {
      if (trimmed === '') this.ports.hostKeys.clear();
      else this.ports.hostKeys.set(trimmed);
    } catch {
      this.ports.notify(t('onlineGm.account.noStorageHostKey'));
    }
    this.changed();
  }

  /** The server address changed: nothing known of the last server holds, and a sign-in that waits is dropped. */
  serverChanged(): void {
    this.flow?.cancel();
    this.me = null;
    this.checkedAt = Number.NEGATIVE_INFINITY;
    this.notice = null;
    this.changed();
    void this.refresh(true);
  }

  /** Asks the relay what the account may host, unless it was asked moments ago (`force` asks anyway). */
  refresh(force = false): Promise<void> {
    const token = this.token();
    if (token === null || isSelfHosted()) return Promise.resolve();
    if (!force && this.me !== null && this.me !== 'unreachable' && this.ports.timers.now() - this.checkedAt < FRESH_MS) return Promise.resolve();
    this.checking ??= this.check(token).finally(() => (this.checking = null));
    return this.checking;
  }

  /** Starts a device sign-in: the approve page opens in the browser, and the dock shows the code. */
  async signIn(): Promise<void> {
    if (this.flow !== null || isSelfHosted()) return;
    const flow = new DeviceSignIn({ http: this.ports.http, timers: this.ports.timers, origin: accountsOrigin(), openUrl: this.ports.openUrl });
    this.flow = flow;
    this.userCode = null;
    this.notice = null;
    this.changed();
    const end = await flow.run((code) => {
      this.userCode = code.userCode;
      this.changed();
    });
    if (this.flow !== flow) return;
    this.flow = null;
    this.userCode = null;
    if (end.kind === 'token') {
      try {
        this.ports.tokens.set(end.token);
      } catch {
        this.ports.notify(t('onlineGm.account.noStorageSignIn'));
        void signOutToken(this.ports.http, accountsOrigin(), end.token);
        return this.changed();
      }
      this.me = null;
      this.changed();
      return this.refresh(true);
    }
    this.notice = end.kind === 'cancelled' ? null : end.kind;
    this.changed();
  }

  /** Opens the approve page again. */
  reopenSignIn(): void {
    this.flow?.reopen();
  }

  cancelSignIn(): void {
    this.flow?.cancel();
  }

  /** Signs this device's session out at the account service and forgets the token. */
  async signOut(): Promise<void> {
    if (isSelfHosted()) return;
    const token = this.token();
    this.forget(null);
    if (token !== null) await signOutToken(this.ports.http, accountsOrigin(), token);
  }

  /** The server refused the token: it is forgotten, and the GM hears that running tables go on. */
  signedOutByServer(): void {
    // A host key the server refuses stays: the GM replaces it in the settings.
    if (isSelfHosted() || this.token() === null) return;
    this.forget('server');
    this.ports.notify(SERVER_SIGNED_OUT_TEXT);
  }

  /** Opens the account page in the browser: invite keys are redeemed there, and it shows what the account may host. */
  openAccountPage(): void {
    if (isSelfHosted()) return;
    this.ports.openUrl(accountPageUrl());
  }

  private async check(token: string): Promise<void> {
    const origin = relayOrigin();
    if (origin === null || isSelfHosted()) return;
    const answer = await new RelayAccount(this.ports.http, origin, token).me();
    if (this.token() !== token) return;
    if (answer === 'signed-out') return this.signedOutByServer();
    this.me = answer === 'unavailable' ? 'unreachable' : answer;
    this.checkedAt = this.ports.timers.now();
    this.changed();
  }

  private forget(notice: SignedOutNotice): void {
    this.ports.tokens.clear();
    this.me = null;
    this.notice = notice;
    this.changed();
  }

  private facts(): AccountFacts {
    return {
      signingIn: this.flow !== null,
      userCode: this.userCode,
      token: this.token() !== null,
      selfHosted: isSelfHosted(),
      me: this.me,
      notice: this.notice,
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
