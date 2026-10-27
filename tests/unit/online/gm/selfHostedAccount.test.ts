import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountControl } from '../../../../src/app/online/gm/account/AccountControl.ts';
import type { HttpRequest, HttpResponse } from '../../../../src/app/online/gm/account/http.ts';
import { readCreated } from '../../../../src/app/online/gm/createdTable.ts';
import { readSavedTable } from '../../../../src/app/online/gm/savedTable.ts';
import { setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';
import { readSettings } from '../../../../src/app/online/gm/settings.ts';

const SELF_HOSTED = 'https://tables.example.com';
const SAVED = { code: 'a'.repeat(26), secret: 's'.repeat(43), campaignId: 'c1', mapPath: null };

function setup(): { control: AccountControl; requests: HttpRequest[]; opened: string[]; account: { value: string | null }; hostKey: { value: string | null } } {
  const requests: HttpRequest[] = [];
  const opened: string[] = [];
  const account = { value: 'account-token' as string | null };
  const hostKey = { value: 'host-key-0123456789' as string | null };
  const control = new AccountControl({
    http: (request): Promise<HttpResponse> => (requests.push(request), Promise.resolve({ status: 200, json: { account: { id: 'a', handle: 'mara', name: 'Mara' }, access: null, reason: 'no-access' } })),
    timers: { now: () => 0, setTimer: () => 0, clearTimer: () => undefined },
    tokens: { get: () => account.value, set: (token) => (account.value = token), clear: () => (account.value = null) },
    hostKeys: { get: () => hostKey.value, set: (key) => (hostKey.value = key), clear: () => (hostKey.value = null) },
    openUrl: (url) => void opened.push(url),
    notify: () => undefined,
  });
  return { control, requests, opened, account, hostKey };
}

afterEach(() => setServerOrigin(null));

describe('the account on a self-hosted server', () => {
  beforeEach(() => setServerOrigin(SELF_HOSTED));

  it('asks tables for the host key, and the account token only upstream', () => {
    const { control } = setup();
    expect(control.token()).toBe('host-key-0123456789');
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    expect(control.token()).toBe('account-token');
  });

  it('makes no account call at all: no sign-in, no sign-out, no /api/me, no account page', async () => {
    const { control, requests, opened, account, hostKey } = setup();
    await control.refresh(true);
    await control.refresh(false);
    await control.signIn();
    await control.signOut();
    control.signedOutByServer();
    control.openAccountPage();
    expect(requests).toEqual([]);
    expect(opened).toEqual([]);
    expect(account.value).toBe('account-token');
    expect(hostKey.value).toBe('host-key-0123456789');
  });

  it('lets a late 401 from the self-hosted server leave the upstream account token alone', () => {
    const { control, account } = setup();
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    control.signedOutByServer(true);
    expect(account.value).toBe('account-token');
  });

  it('shows whether a host key is set, instead of an account', () => {
    const { control, hostKey } = setup();
    expect(control.view()).toEqual({ kind: 'host-key', set: true });
    hostKey.value = null;
    expect(control.view()).toEqual({ kind: 'host-key', set: false });
    expect(control.token()).toBeNull();
  });

  it('keeps and replaces the host key, tells listeners, and forgets it when given none', () => {
    const { control, hostKey } = setup();
    let told = 0;
    control.onChange(() => told++);
    control.setHostKey('  new-key  ');
    expect(hostKey.value).toBe('new-key');
    control.setHostKey('');
    expect(hostKey.value).toBeNull();
    expect(told).toBe(2);
    control.serverChanged();
    expect(told).toBe(3);
  });

  it('keeps the host key when the server refuses it, and says so', () => {
    const { control, hostKey } = setup();
    expect(readCreated(401, { error: 'unauthorized' })).toBe('The host key is not accepted by this server.');
    control.signedOutByServer();
    expect(hostKey.value).toBe('host-key-0123456789');
  });

  it('asks upstream\'s account again after the server is switched back', async () => {
    const { control, requests } = setup();
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    control.serverChanged();
    await Promise.resolve();
    expect(requests.map((request) => request.url)).toEqual([`${UPSTREAM_RELAY_ORIGIN}/api/me`]);
  });
});

describe('the account with no server address set (the default)', () => {
  beforeEach(() => setServerOrigin(null));

  it('makes no network call and opens no page: no sign-in, no sign-out, no /api/me, no account page', async () => {
    const { control, requests, opened, account } = setup();
    await control.refresh(true);
    await control.refresh(false);
    await control.signIn();
    await control.signOut();
    control.signedOutByServer();
    control.openAccountPage();
    control.serverChanged();
    await Promise.resolve();
    expect(requests).toEqual([]);
    expect(opened).toEqual([]);
    expect(account.value).toBe('account-token');
  });

  it('shows the no-server state, never Sign in or Checking your account, even with a token held', () => {
    const { control, account } = setup();
    expect(control.view()).toEqual({ kind: 'no-server' });
    account.value = null;
    expect(control.view()).toEqual({ kind: 'no-server' });
  });

  it('hands no token to a table start', () => {
    expect(setup().control.token()).toBeNull();
  });
});

describe('a saved table', () => {
  it('records the server it was made on; one saved before counts as upstream\'s', () => {
    expect(readSavedTable({ ...SAVED, origin: SELF_HOSTED })?.origin).toBe(SELF_HOSTED);
    expect(readSavedTable({ ...SAVED, origin: 'https://A.com/' })?.origin).toBe('https://a.com');
    expect(readSavedTable(SAVED)?.origin).toBe(UPSTREAM_RELAY_ORIGIN);
    expect(readSavedTable({ ...SAVED, origin: 'nope' })).toBeNull();
    expect(readSavedTable({ ...SAVED, origin: 7 })).toBeNull();
  });
});

describe('the server address setting', () => {
  it('is read normalised, and empty where it is no address', () => {
    expect(readSettings({ serverOrigin: 'https://A.com/' }).serverOrigin).toBe('https://a.com');
    expect(readSettings({ serverOrigin: 'nope' }).serverOrigin).toBe('');
    expect(readSettings({ serverOrigin: 5 }).serverOrigin).toBe('');
    expect(readSettings(null).serverOrigin).toBe('');
  });
});
