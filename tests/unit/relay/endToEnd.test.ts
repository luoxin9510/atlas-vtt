import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { OnlineControl } from '../../../src/app/online/gm/OnlineControl.ts';
import { AccountControl } from '../../../src/app/online/gm/account/AccountControl.ts';
import { secretHostKeyStore, type TokenStore } from '../../../src/app/online/gm/account/tokenStore.ts';
import { setServerOrigin } from '../../../src/app/online/gm/servers.ts';
import { boundOwnership, FAKE_LINK, fakeCampaigns } from '../online/gm/fakeSeats.ts';
import { app, atlasTab, png, present, workspace } from '../online/gm/fakeTable.ts';
import { sceneState } from '../online/gm/shareHarness.ts';
import { headlessPlayer, type HeadlessPlayer } from './headlessPlayer.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY } from './relayHarness.ts';
import type { SavedTable } from '../../../src/app/online/gm/savedTable.ts';

const seen = vi.hoisted(() => ({ requests: [] as { readonly url: string; readonly headers?: Record<string, string> }[] }));

interface ObsidianRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly contentType?: string;
}

// Obsidian's requestUrl, answered by the real relay over the network.
vi.mock('obsidian', () => ({
  Notice: class {},
  normalizePath: (path: string) => path,
  requestUrl: async (request: ObsidianRequest): Promise<{ status: number; json: unknown; text: string; headers: Record<string, string> }> => {
    seen.requests.push(request);
    const response = await fetch(request.url, {
      method: request.method ?? 'GET',
      headers: { ...request.headers, ...(request.contentType === undefined ? {} : { 'content-type': request.contentType }) },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: Object.fromEntries(response.headers) };
  },
  requireApiVersion: () => true,
  PluginSettingTab: class {},
  Setting: class {},
}));

vi.mock('../../../src/app/online/gm/gmMarks.ts', () => ({
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

vi.mock('../../../src/app/online/gm/atlasLighting.ts', async (original) => ({
  ...(await original<typeof import('../../../src/app/online/gm/atlasLighting.ts')>()),
  accentColour: () => '#112233',
}));

/** The GM's window in Obsidian: the Electron origin on the GM socket. */
class ObsidianWebSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { origin: 'app://obsidian.md' } });
  }
}

const MAP = 'Scenes/Cave.atlasmap';
workspace.files = new Map<string, Uint8Array>([['maps/cave.png', png(700, 700)]]);

const running: Array<{ close(): Promise<void> }> = [];
const players: HeadlessPlayer[] = [];
let online: OnlineControl | null = null;

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', ObsidianWebSocket);
  seen.requests.length = 0;
  workspace.leaves = [];
  workspace.presented = null;
});

afterEach(async () => {
  online?.close();
  online = null;
  for (const player of players.splice(0)) player.socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  setServerOrigin(null);
  vi.unstubAllGlobals();
});

/** A host key kept in Obsidian's secret storage, which the fake app holds in memory. */
function hostKeyStore(): TokenStore {
  const secrets = new Map<string, string>();
  Object.assign(app, { secretStorage: { getSecret: (id: string) => secrets.get(id) ?? null, setSecret: (id: string, value: string) => void secrets.set(id, value) } });
  return secretHostKeyStore(app);
}

describe('a table from the GM through the self-hosted relay to a player', () => {
  it('starts with the host key, admits a player by the join code, shows them the scene and ends with 4008', async () => {
    const relay = await startTestRelay();
    running.push(relay);
    setServerOrigin(relay.origin);

    const nothing = { get: () => null, set: () => undefined, clear: () => undefined };
    const account = new AccountControl({ http: () => Promise.reject(new Error('no account call on a self-hosted server')), timers: { now: () => Date.now(), setTimer: () => 0, clearTimer: () => undefined }, tokens: nothing, hostKeys: hostKeyStore(), openUrl: () => undefined, notify: (text) => { throw new Error(text); } });
    account.setHostKey(TEST_HOST_KEY);

    const tab = atlasTab(sceneState({ mapPath: MAP, background: 'maps/cave.png' }));
    workspace.leaves = [tab.leaf];
    present(tab);
    const saves: (SavedTable | null)[] = [];
    online = new OnlineControl(app, boundOwnership([]), fakeCampaigns([]), (table) => saves.push(table), { token: () => account.token(), signedOutByServer: () => undefined, refresh: () => Promise.resolve() });

    const table = await online.start(tab.leaf, 'c1');
    if (table === null) throw new Error('no table');
    // The table was asked for with the host key, on the relay's own address, and nothing else was requested.
    expect(seen.requests.map(({ url }) => url)).toEqual([`${relay.origin}/api/tables`]);
    expect(seen.requests[0]?.headers).toEqual({ Authorization: `Bearer ${TEST_HOST_KEY}` });
    expect(online.link()).toBe(`${relay.origin}/#${FAKE_LINK}`);
    expect(saves.at(-1)).toMatchObject({ origin: relay.origin, code: FAKE_LINK });
    await vi.waitFor(() => expect(online?.status()).toBe('online'), { timeout: 5_000 });

    // A newcomer is told the join code apart from the link; with the code and no waiting, they are in.
    table.gate.setAskToJoin(false);
    const { code } = table.gate.settings;
    const wrong = code === '000000' ? '111111' : '000000';
    const turned = await headlessPlayer(relay.origin, FAKE_LINK, { name: 'Bob', code: wrong });
    players.push(turned);
    // A refused join fails fast, with the close code, instead of hanging.
    await expect(turned.welcome).rejects.toThrow(/closed 4\d{3} before a welcome/);
    const player = await headlessPlayer(relay.origin, FAKE_LINK, { name: 'Ana', code });
    players.push(player);
    const welcome = await player.welcome;
    expect(welcome.id).toMatch(/\S/);
    await vi.waitFor(() => expect(player.messages.some((message) => message.t === 'scene' && message.scene !== null)).toBe(true), { timeout: 10_000 });
    expect(player.messages.find((message) => message.t === 'scene')).toMatchObject({ scene: { map: { mime: 'image/png' } } });

    online.stop();
    expect(await player.closed).toBe(4008);
  }, 20_000);
});
