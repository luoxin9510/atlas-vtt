import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineControl } from '../../../../src/app/online/gm/OnlineControl.ts';
import type { SavedTable } from '../../../../src/app/online/gm/savedTable.ts';
import { setServerOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';
import { NO_SERVER_TEXT, startBlock } from '../../../../src/app/online/gm/tableStart.ts';
import { boundOwnership, FAKE_LINK, fakeCampaigns } from './fakeSeats.ts';
import { app, atlasTab, FakeSocket, workspace } from './fakeTable.ts';
import { sceneState } from './shareHarness.ts';
import { advanceSettled as advance } from './settled.ts';

const SELF_HOSTED = 'https://tables.example.com';
const OTHER = 'https://other.example.com';

const seen = vi.hoisted(() => ({
  notices: [] as string[],
  requests: [] as { readonly url?: string; readonly headers?: Record<string, string> }[],
  answer: { status: 201, json: null as unknown },
  /** Runs when the relay's answer is about to be given: a test changes the setting here. */
  during: null as (() => void) | null,
}));

vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  Notice: class {
    constructor(text: string) {
      seen.notices.push(text);
    }
  },
  requestUrl: (request: { readonly url?: string; readonly headers?: Record<string, string>; readonly body?: string }) => {
    seen.requests.push(request);
    seen.during?.();
    return Promise.resolve(seen.answer);
  },
}));

vi.mock('../../../../src/app/online/gm/gmMarks.ts', () => ({
  GmMarks: class {
    source(): null {
      return null;
    }
    showPlayers(): void {}
    showPlayerDrags(): void {}
    showPlayerCursors(): void {}
    dispose(): void {}
  },
}));

const hostKey = { value: 'host-key-0123456789' as string | null, refused: vi.fn() };
const account = { token: (): string | null => hostKey.value, signedOutByServer: hostKey.refused, refresh: vi.fn(() => Promise.resolve()) };
const SECRET = 'n'.repeat(43);
const saved = (origin: string): SavedTable => ({ code: 'a'.repeat(26), secret: 's'.repeat(43), maxPlayers: 12, campaignId: 'c1', mapPath: null, gate: { code: '483912', requireCode: true, askToJoin: true }, origin });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.all = [];
  seen.notices.length = 0;
  seen.requests.length = 0;
  seen.during = null;
  seen.answer = { status: 201, json: { code: FAKE_LINK, secret: SECRET, maxPlayers: 8 } };
  hostKey.value = 'host-key-0123456789';
  hostKey.refused.mockClear();
  setServerOrigin(SELF_HOSTED);
  workspace.leaves = [];
});

afterEach(() => {
  setServerOrigin(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tab = (): ReturnType<typeof atlasTab> => {
  const made = atlasTab(sceneState({ mapPath: 'Scenes/Cave.atlasmap' }));
  workspace.leaves = [made.leaf];
  return made;
};

describe('starting a table on a self-hosted server', () => {
  it('sends the host key as the bearer of the table request, to that server only', async () => {
    const { leaf } = tab();
    const saves: (SavedTable | null)[] = [];
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), (table) => saves.push(table), account);
    expect(await online.start(leaf, 'c1')).not.toBeNull();
    expect(seen.requests.map((request) => request.url)).toEqual([`${SELF_HOSTED}/api/tables`]);
    expect(seen.requests[0]?.headers?.Authorization).toBe('Bearer host-key-0123456789');
    expect(saves.at(-1)?.origin).toBe(SELF_HOSTED);
    online.stop();
  });

  it('keeps the host key on a 401 and says it is not accepted', async () => {
    const { leaf } = tab();
    seen.answer = { status: 401, json: { error: 'unauthorized' } };
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), () => undefined, account);
    expect(await online.start(leaf, 'c1')).toBeNull();
    expect(seen.notices).toEqual(['The host key is not accepted by this server.']);
    expect(hostKey.value).toBe('host-key-0123456789');
  });

  it('is refused, saying what is missing, while there is no host key', () => {
    hostKey.value = null;
    expect(startBlock(tab().leaf, 'c1', account)).toBe('Set the host key in Atlas settings first.');
    setServerOrigin(UPSTREAM_RELAY_ORIGIN);
    expect(startBlock(tab().leaf, 'c1', account)).toBe('Sign in to host first.');
    setServerOrigin(null);
    expect(startBlock(tab().leaf, 'c1', account)).toBe(NO_SERVER_TEXT);
  });

  it('ends a table made on the server it asked when the address changes before it runs', async () => {
    const { leaf } = tab();
    const saves: (SavedTable | null)[] = [];
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), (table) => saves.push(table), account);
    seen.during = () => setServerOrigin(OTHER);
    expect(await online.start(leaf, 'c1')).toBeNull();
    await advance(0);
    expect(online.table).toBeNull();
    expect(saves).toEqual([]);
    expect(seen.notices).toEqual([]);
    // The stray table is ended on the server it was made on, with its own secret.
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([`wss://tables.example.com/api/tables/${FAKE_LINK}/socket`]);
    const socket = FakeSocket.all[0];
    expect(socket?.frames()[0]).toMatchObject({ t: 'hello', role: 'gm', secret: SECRET });
    socket?.relay({ t: 'welcome', role: 'gm', players: [] });
    expect(socket?.frames().some((frame) => frame.t === 'end')).toBe(true);
  });

  it('ends a table made when the address was cleared before it runs', async () => {
    const { leaf } = tab();
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), () => undefined, account);
    seen.during = () => setServerOrigin(null);
    expect(await online.start(leaf, 'c1')).toBeNull();
    await advance(0);
    expect(online.table).toBeNull();
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([`wss://tables.example.com/api/tables/${FAKE_LINK}/socket`]);
  });
});

describe('a saved table after a reload', () => {
  it('is not replayed on another server than the one it was made on', async () => {
    tab();
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), () => undefined, account);
    expect(await online.resume(saved(OTHER))).toBeNull();
    expect(await online.resume(saved(UPSTREAM_RELAY_ORIGIN))).toBeNull();
    await advance(0);
    expect(FakeSocket.all).toEqual([]);
    expect(online.table).toBeNull();
  });

  it('is replayed on the server it was made on', async () => {
    tab();
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), () => undefined, account);
    void online.resume(saved(SELF_HOSTED));
    await advance(0);
    expect(FakeSocket.all.map((socket) => socket.url)).toEqual([`wss://tables.example.com/api/tables/${'a'.repeat(26)}/socket`]);
    online.stop();
  });

  it('is not replayed while no server address is set', async () => {
    tab();
    setServerOrigin(null);
    const online = new OnlineControl(app, boundOwnership([]), fakeCampaigns(), () => undefined, account);
    expect(await online.resume(saved(SELF_HOSTED))).toBeNull();
    await advance(0);
    expect(FakeSocket.all).toEqual([]);
  });
});
