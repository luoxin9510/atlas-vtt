import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { Session } from '../../../apps/play/src/app/session.ts';
import { mapRequest } from '../../../apps/play/src/scene/mapRequest.ts';
import type { SocketLike } from '../../../apps/play/src/net/TableSocket.ts';
import { OnlineControl } from '../../../src/app/online/gm/OnlineControl.ts';
import { AccountControl } from '../../../src/app/online/gm/account/AccountControl.ts';
import { secretHostKeyStore, type TokenStore } from '../../../src/app/online/gm/account/tokenStore.ts';
import { setServerOrigin } from '../../../src/app/online/gm/servers.ts';
import type { SceneState } from '../../../src/app/online/gm/atlasView.ts';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../../src/app/types/initiativeTypes';
import { boundOwnership, FAKE_LINK, fakeCampaigns } from '../online/gm/fakeSeats.ts';
import { app, atlasTab, png, present, workspace } from '../online/gm/fakeTable.ts';
import { GENERIC_SOURCE } from '../online/gm/gmLighting.ts';
import { DICE_TOOL, type DiceToolClass } from '../online/gm/realDice.ts';
import { sceneState, token } from '../online/gm/shareHarness.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from '../relay/relayHarness.ts';

const { DiceTool } = (await import(/* @vite-ignore */ DICE_TOOL)) as { DiceTool: DiceToolClass };

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
    source(): null { return null; }
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

/** A player's page socket in Node: the browser's origin header, seen as the app's `SocketLike`. */
function openPlayerSocket(url: string): SocketLike {
  const ws = new WebSocket(url, { headers: { origin: TEST_PUBLIC_ORIGIN } });
  const like: SocketLike = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    get readyState() { return ws.readyState; },
    get bufferedAmount() { return ws.bufferedAmount; },
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  ws.on('open', () => like.onopen?.());
  ws.on('message', (data) => like.onmessage?.({ data: String(data) }));
  ws.on('close', (code) => like.onclose?.({ code }));
  ws.on('error', () => like.onerror?.());
  return like;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as unknown as Storage;
}

const MAP = 'Scenes/Cave.atlasmap';
workspace.files = new Map<string, Uint8Array>([['maps/cave.png', png(700, 700)]]);

const entry = (tokenId: string, order: number, active: boolean): InitiativeEntry => ({
  id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 10, initiativeModifier: 0, imagePath: '', isActive: active, isNPC: true, order,
});
const tokens = { hero: token('hero', { x: 105 }), ogre: token('ogre', { x: 315 }) };
const scene = (active: string, lit = false): SceneState => ({
  ...sceneState({ mapPath: MAP, background: 'maps/cave.png', lighting: { enabled: lit, ambient: 1 }, objects: { ...sceneState().objects, tokens } }),
  initiative: { ...createDefaultInitiativeState(), isActive: true, round: 1, entries: [entry('hero', 0, active === 'hero'), entry('ogre', 1, active === 'ogre')] },
  initiativeTrackerOpen: true,
} as SceneState);

const running: Array<{ close(): Promise<void> }> = [];
const sessions: Session[] = [];
let online: OnlineControl | null = null;

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', ObsidianWebSocket);
  workspace.leaves = [];
  workspace.presented = null;
});

afterEach(async () => {
  for (const session of sessions.splice(0)) session.leave();
  online?.close();
  online = null;
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  setServerOrigin(null);
  vi.unstubAllGlobals();
});

function hostKeyStore(): TokenStore {
  const secrets = new Map<string, string>();
  Object.assign(app, { secretStorage: { getSecret: (id: string) => secrets.get(id) ?? null, setSecret: (id: string, value: string) => void secrets.set(id, value) } });
  return secretHostKeyStore(app);
}

/** The GM's Atlas: player view settings with the initiative and dice shown, and Atlas's real dice tool on a bus. */
function atlasPlugin(): void {
  const bus = new EventEmitter();
  let ids = 0;
  const rules = { defaultRoll: '1d20', crit: 'natural' } as const;
  const tool = new DiceTool(bus, () => rules, { random: () => 0.5, rollId: () => `roll_${(ids += 1)}`, roller: () => 'Player', onFormulaError: () => undefined });
  Object.assign(app, {
    plugins: {
      plugins: {
        'atlas-vtt': {
          presentedScene: (app as unknown as { plugins: { plugins: Record<string, { presentedScene: unknown }> } }).plugins.plugins['atlas-vtt']?.presentedScene,
          settingsService: {
            getLocalPlayerViewSettings: () => ({ showTokenNameplates: true, showDiceRolls: true, showInitiative: true, showWidgets: false, showCursors: false }),
          },
        },
      },
    },
  });
  const services = { getToolController: () => ({ getDiceTool: () => tool }), getEventBus: () => bus };
  Object.assign(workspace, { dice: services });
}

describe('a table from the GM through the relay to the player app', () => {
  it('shows the map and tokens, keeps a self roll private, announces the turn, fails closed on a lit scene and survives a relay restart', async () => {
    atlasPlugin();
    const relay = await startTestRelay();
    running.push(relay);
    setServerOrigin(relay.origin);

    const nothing = { get: () => null, set: () => undefined, clear: () => undefined };
    const account = new AccountControl({ http: () => Promise.reject(new Error('no account call')), timers: { now: () => Date.now(), setTimer: () => 0, clearTimer: () => undefined }, tokens: nothing, hostKeys: hostKeyStore(), openUrl: () => undefined, notify: (text) => { throw new Error(text); } });
    account.setHostKey(TEST_HOST_KEY);

    const tab = atlasTab(scene('ogre'));
    const services = (workspace as unknown as { dice: object }).dice;
    Object.assign(tab.view, { viewId: 'view-1' });
    Object.assign(tab.view.serviceManager, services);
    Object.assign(tab.view.renderer ?? {}, { lighting: { sightAids: { deps: { rules: GENERIC_SOURCE.rules, measurement: GENERIC_SOURCE.measurement } } } });
    workspace.leaves = [tab.leaf];
    present(tab);
    online = new OnlineControl(app, boundOwnership([]), fakeCampaigns([]), () => undefined, { token: () => account.token(), signedOutByServer: () => undefined, refresh: () => Promise.resolve() });
    const table = await online.start(tab.leaf, 'c1');
    if (table === null) throw new Error('no table');
    await vi.waitFor(() => expect(online?.status()).toBe('online'), { timeout: 5_000 });
    table.gate.setAskToJoin(false);
    await vi.waitFor(() => expect(relay.links.peek(FAKE_LINK)?.gate).toEqual({ code: table.gate.settings.code, ask: false }));
    const { code: joinCode } = table.gate.settings;

    const frames: Record<string, string[]> = { ana: [], ben: [] };
    const join = (name: 'ana' | 'ben'): Session => {
      const session = new Session({
        origin: relay.origin, code: FAKE_LINK, storage: memoryStorage(), indexedDB: null,
        open: (url) => {
          const socket = openPlayerSocket(url);
          const send = socket.send;
          socket.send = (data) => { frames[name]?.push(data); send(data); };
          return socket;
        },
      });
      sessions.push(session);
      session.join({ name: name === 'ana' ? 'Ana' : 'Ben', code: joinCode });
      return session;
    };
    const ana = join('ana');
    const ben = join('ben');

    // Both are in; the GM gives Ana the hero.
    await vi.waitFor(() => expect(ana.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
    await vi.waitFor(() => expect(ben.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
    const anaId = ana.store.getState().self;
    if (anaId === null) throw new Error('no id');
    await vi.waitFor(() => expect(table.ownership.nameOf(anaId)).toBe('Ana'), { timeout: 5_000 });
    table.ownership.give(['hero'], {}, anaId);

    // The map, both tokens, and the token that is Ana's.
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('map'), { timeout: 10_000 });
    await vi.waitFor(() => expect(ana.store.getState().tokens).toHaveLength(2), { timeout: 10_000 });
    await vi.waitFor(() => expect(ana.store.getState().mine.size).toBe(1), { timeout: 10_000 });
    expect(ben.store.getState().mine.size).toBe(0);
    expect(frames.ana?.some((frame) => frame.includes('"forkLevel":1'))).toBe(true);

    // The map loads and verifies against its hash, as the scene view asks for it.
    const wanted = mapRequest(ana.store.getState(), false, 8192);
    if (wanted === null) throw new Error('no map wanted');
    const loaded = await ana.assets.load(wanted.ref, wanted.maxSide);
    expect(loaded?.mime).toBe('image/png');
    expect(loaded?.bytes.length).toBeGreaterThan(0);

    // A self roll is in Ana's log and the GM's, and in nobody else's.
    const sceneId = ana.store.getState().scene?.id ?? '';
    expect(ana.send({ t: 'roll', scene: sceneId, formula: '1d20', token: null, mode: 'self' })).toBe(true);
    const rolls = (session: Session): number => session.log.snapshot().entries.filter((shown) => JSON.stringify(shown).includes('"roll"') && JSON.stringify(shown).includes('1d20')).length;
    await vi.waitFor(() => expect(rolls(ana)).toBe(1), { timeout: 10_000 });
    expect(table.log.entries().some((logged) => logged.kind === 'roll')).toBe(true);
    await new Promise((done) => setTimeout(done, 500));
    expect(rolls(ben)).toBe(0);
    expect(JSON.stringify(ben.log.snapshot())).not.toContain('1d20');
    expect(ben.log.snapshot().people.map((person) => person.name).sort()).toEqual(['Ana', 'Ben']);

    // The turn goes to Ana's hero: she is told once, he is not.
    tab.store.set(scene('hero'));
    await vi.waitFor(() => expect(ana.store.getState().yourTurnAt).not.toBeNull(), { timeout: 10_000 });
    expect(ben.store.getState().yourTurnAt).toBeNull();

    // The GM lights the scene: the player fails closed and asks for no picture.
    const askedBefore = frames.ana?.filter((frame) => frame.includes('asset-request')).length ?? 0;
    tab.store.set(scene('hero', true));
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('lit-placeholder'), { timeout: 10_000 });
    expect(ana.store.getState().tokens).toHaveLength(0);
    expect(mapRequest(ana.store.getState(), false, 8192)).toBeNull();
    expect(frames.ana?.filter((frame) => frame.includes('asset-request')).length).toBe(askedBefore);

    // The relay restarts on the same port and state: the player comes back with her key and the table resyncs.
    tab.store.set(scene('hero'));
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('map'), { timeout: 10_000 });
    const key = JSON.parse(frames.ana?.[0] ?? '{}') as { key?: string };
    expect(key.key).toBeUndefined();
    const { port } = new URL(relay.origin);
    const { statePath } = relay.config;
    await relay.close();
    running.length = 0;
    const again = await startTestRelay({ port: Number(port), statePath });
    running.push(again);
    const hellos = (): string[] => frames.ana?.filter((f) => f.includes('"t":"hello"')) ?? [];
    await vi.waitFor(() => expect(hellos()).toHaveLength(2), { timeout: 30_000 });
    await vi.waitFor(() => expect(ana.store.getState().status.kind).toBe('joined'), { timeout: 30_000 });
    expect(ana.store.getState().self).toBe(anaId);
    tab.store.set(scene('ogre'));
    await vi.waitFor(() => expect(ana.store.getState().tokens).toHaveLength(2), { timeout: 15_000 });
    expect(ana.store.getState().mode).toBe('map');
    expect(JSON.parse(hellos()[1] ?? '{}')).toMatchObject({ role: 'player', name: 'Ana', key: expect.any(String) });
  }, 90_000);
});

