import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const realFetch = globalThis.fetch.bind(globalThis);

interface ObsidianRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | ArrayBuffer;
  readonly contentType?: string;
}

// Obsidian's requestUrl, answered by the real relay over the network.
vi.mock('obsidian', () => ({
  Notice: class {},
  normalizePath: (path: string) => path,
  requestUrl: async (request: ObsidianRequest): Promise<{ status: number; json: unknown; text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string> }> => {
    const response = await realFetch(request.url, {
      method: request.method ?? 'GET',
      headers: { ...request.headers, ...(request.contentType === undefined ? {} : { 'content-type': request.contentType }) },
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, arrayBuffer, headers: Object.fromEntries(response.headers) };
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

  // What the GM puts on the wire, so a test can tell what it served to whom.
  override send(data: Parameters<WebSocket['send']>[0], ...rest: unknown[]): void {
    gmSent.push(String(data));
    (super.send as (...args: unknown[]) => void)(data, ...rest);
  }
}

/** Every frame the GM's socket sent, in order. */
const gmSent: string[] = [];
/** The asset messages among them (`asset-chunk`, `asset-variant`; with `ticket`, `asset-ticket` too) as `[hash, player]`. */
function assetsServed(from: number, ticket = false): [string, string | undefined][] {
  const kinds = ticket ? ['asset-chunk', 'asset-variant', 'asset-ticket'] : ['asset-chunk', 'asset-variant'];
  return gmSent.slice(from).flatMap((text) => {
    const frame = JSON.parse(text.startsWith('{') ? text : '{}') as { t?: string; to?: string; body?: { t?: string; hash?: string } };
    const body = frame.body;
    return frame.t === 'send' && body !== undefined && body.t !== undefined && kinds.includes(body.t) && body.hash !== undefined ? [[body.hash, frame.to] as [string, string | undefined]] : [];
  });
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
const scene = (active: string, lit = false, heroX = 105): SceneState => ({
  ...sceneState({ mapPath: MAP, background: 'maps/cave.png', lighting: { enabled: lit, ambient: 1 }, objects: { ...sceneState().objects, tokens: { hero: token('hero', { x: heroX }), ogre: token('ogre', { x: 315 }) } } }),
  initiative: { ...createDefaultInitiativeState(), isActive: true, round: 1, entries: [entry('hero', 0, active === 'hero'), entry('ogre', 1, active === 'ogre')] },
  initiativeTrackerOpen: true,
} as SceneState);

const running: Array<{ close(): Promise<void> }> = [];
const sessions: Session[] = [];
let online: OnlineControl | null = null;
let relayOrigin = '';

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', ObsidianWebSocket);
  workspace.leaves = [];
  workspace.presented = null;
  gmSent.length = 0;
  // A ticket url is a path of the relay; the page's own fetch resolves it against its origin.
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => realFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, relayOrigin) : input, init));
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

interface Booted {
  readonly relay: Awaited<ReturnType<typeof startTestRelay>>;
  readonly tab: ReturnType<typeof atlasTab>;
  readonly table: NonNullable<Awaited<ReturnType<OnlineControl['start']>>>;
  readonly joinCode: string;
  readonly frames: Record<string, string[]>;
  join(name: 'ana' | 'ben'): Session;
}

/** A relay, a GM with a scene on the real OnlineControl, and a way to let players in. */
async function boot(relayOverrides: Parameters<typeof startTestRelay>[0] = {}, first: SceneState = scene('ogre')): Promise<Booted> {
  atlasPlugin();
  const relay = await startTestRelay(relayOverrides);
  running.push(relay);
  relayOrigin = relay.origin;
  setServerOrigin(relay.origin);

  const nothing = { get: () => null, set: () => undefined, clear: () => undefined };
  const account = new AccountControl({ http: () => Promise.reject(new Error('no account call')), timers: { now: () => Date.now(), setTimer: () => 0, clearTimer: () => undefined }, tokens: nothing, hostKeys: hostKeyStore(), openUrl: () => undefined, notify: (text) => { throw new Error(text); } });
  account.setHostKey(TEST_HOST_KEY);

  const tab = atlasTab(first);
  // The fake tab's store ignores writes; the GM's moves go through `setState(draft => ...)`, so let it apply them.
  Object.assign(tab.store, {
    setState: (update: ((draft: SceneState) => void) | Partial<SceneState>): void => {
      const draft = structuredClone(tab.store.getState());
      if (typeof update === 'function') update(draft);
      else Object.assign(draft, update);
      tab.store.set(draft);
    },
  });
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
  return { relay, tab, table, joinCode, frames, join };
}

/** Ana is in and owns the hero, with the scene on her screen. */
async function anaWithHero(game: Booted): Promise<{ ana: Session; anaId: string }> {
  const ana = game.join('ana');
  await vi.waitFor(() => expect(ana.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
  const anaId = ana.store.getState().self;
  if (anaId === null) throw new Error('no id');
  await vi.waitFor(() => expect(game.table.ownership.nameOf(anaId)).toBe('Ana'), { timeout: 5_000 });
  game.table.ownership.give(['hero'], {}, anaId);
  await vi.waitFor(() => expect(ana.store.getState().mine.size).toBe(1), { timeout: 10_000 });
  await vi.waitFor(() => expect(ana.store.getState().tokens).toHaveLength(2), { timeout: 10_000 });
  return { ana, anaId };
}

const mapOf = (session: Session): { hash: string; wanted: NonNullable<ReturnType<typeof mapRequest>> } => {
  const wanted = mapRequest(session.store.getState(), false, 8192);
  if (wanted === null) throw new Error('no map wanted');
  return { hash: wanted.ref.hash, wanted };
};

describe('a table from the GM through the relay to the player app', () => {
  it('shows the map and tokens, keeps a self roll private, announces the turn, fails closed on a lit scene and survives a relay restart', async () => {
    const game = await boot();
    const { relay, tab, table, frames } = game;
    const ana = game.join('ana');
    const ben = game.join('ben');

    // Both are in; the GM gives Ana the hero.
    await vi.waitFor(() => expect(ana.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
    await vi.waitFor(() => expect(ben.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
    const anaId = ana.store.getState().self;
    if (anaId === null) throw new Error('no id');
    await vi.waitFor(() => expect(table.ownership.nameOf(anaId)).toBe('Ana'), { timeout: 5_000 });
    table.ownership.give(['hero'], {}, anaId);

    // The map, both tokens, and the token that is Ana's.
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('unlit'), { timeout: 10_000 });
    await vi.waitFor(() => expect(ana.store.getState().tokens).toHaveLength(2), { timeout: 10_000 });
    await vi.waitFor(() => expect(ana.store.getState().mine.size).toBe(1), { timeout: 10_000 });
    expect(ben.store.getState().mine.size).toBe(0);
    expect(frames.ana?.some((frame) => frame.includes('"forkLevel":3'))).toBe(true);

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

    // The GM lights the scene: the player fails closed.
    // Covered: (a) the GM sent this player the map (chunks or a ticket) before (so the check below can fail), (b) after the
    // switch the GM serves no chunk or variant of that hash to anyone and (c) the request path the scene view uses
    // (`mapRequest`) is null for a lit scene. Not covered here: the Pixi view itself (see the browser test).
    const mapHash = ana.store.getState().scene?.map?.hash ?? '';
    expect(assetsServed(0, true).some(([hash, to]) => hash === mapHash && to === anaId)).toBe(true);
    const servedBefore = gmSent.length;
    ana.store.setLighting('unsupported');
    tab.store.set(scene('hero', true));
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('placeholder'), { timeout: 10_000 });
    expect(ana.store.getState().tokens).toHaveLength(0);
    expect(mapRequest(ana.store.getState(), false, 8192)).toBeNull();
    await new Promise((done) => setTimeout(done, 1_000));
    expect(gmSent.length).toBeGreaterThan(servedBefore);
    expect(assetsServed(servedBefore, true)).toEqual([]);

    // The relay restarts on the same port and state: the player comes back with her key and the table resyncs.
    tab.store.set(scene('hero'));
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('unlit'), { timeout: 10_000 });
    await vi.waitFor(() => expect(ana.store.getState().tokens).toHaveLength(2), { timeout: 10_000 });
    ana.store.dismissYourTurn();
    const key = JSON.parse(frames.ana?.[0] ?? '{}') as { key?: string };
    expect(key.key).toBeUndefined();
    const { port } = new URL(relay.origin);
    const { statePath } = relay.config;
    await relay.close();
    running.length = 0;
    // While the relay is down the GM moves the hero: the player can only learn of it by resyncing.
    tab.store.set(scene('hero', false, 205));
    expect(ana.store.getState().tokens.some((entry) => entry.x === 205)).toBe(false);
    const again = await startTestRelay({ port: Number(port), statePath });
    running.push(again);
    const hellos = (): string[] => frames.ana?.filter((f) => f.includes('"t":"hello"')) ?? [];
    await vi.waitFor(() => expect(hellos()).toHaveLength(2), { timeout: 30_000 });
    await vi.waitFor(() => expect(ana.store.getState().status.kind).toBe('joined'), { timeout: 30_000 });
    expect(ana.store.getState().self).toBe(anaId);
    await vi.waitFor(() => expect(ana.store.getState().tokens.some((entry) => entry.x === 205)).toBe(true), { timeout: 30_000 });
    expect(ana.store.getState().mode).toBe('unlit');
    expect(ana.store.getState().mine.size).toBe(1);
    // A resync is no new turn.
    expect(ana.store.getState().yourTurnAt).toBeNull();
    expect(JSON.parse(hellos()[1] ?? '{}')).toMatchObject({ role: 'player', name: 'Ana', key: expect.any(String) });
  }, 90_000);
});

describe('the image cache, pause and moves between the GM and a player', () => {
  it('delivers the map by ticket: no chunk for it, and the relay holds its hash', async () => {
    const game = await boot({ assetDir: join(tmpdir(), `atlas-e2e-assets-${process.pid}`) });
    const { ana, anaId } = await anaWithHero(game);
    await vi.waitFor(() => expect(ana.store.getState().mode).toBe('unlit'), { timeout: 10_000 });
    const { hash, wanted } = mapOf(ana);
    const before = gmSent.length;
    const loaded = await ana.assets.load(wanted.ref, wanted.maxSide);
    expect(loaded?.mime).toBe('image/png');
    expect(assetsServed(0).filter(([served, to]) => served === hash && to === anaId)).toEqual([]);
    expect(assetsServed(before, true).some(([served, to]) => served === hash && to === anaId)).toBe(true);
    const tableCode = game.table.link.split('#')[1] ?? '';
    expect(game.relay.assets.has(tableCode, hash)).toBe(true);
    expect(ana.log.snapshot().entries.map((entry) => JSON.stringify(entry)).join('')).not.toContain('直接发送');
  }, 60_000);

  it('falls back to chunks when the relay cannot store images', async () => {
    const game = await boot({ maxServerAssetBytes: 0 });
    const { ana, anaId } = await anaWithHero(game);
    const { hash, wanted } = mapOf(ana);
    const loaded = await ana.assets.load(wanted.ref, wanted.maxSide);
    expect(loaded?.mime).toBe('image/png');
    expect(assetsServed(0).some(([served, to]) => served === hash && to === anaId)).toBe(true);
    expect(game.relay.assets.has(game.table.link.split('#')[1] ?? '', hash)).toBe(false);
  }, 60_000);

  it('shows one fallback line when a ticketed download fails, and gets the map by chunks', async () => {
    const game = await boot();
    const { ana, anaId } = await anaWithHero(game);
    const { hash, wanted } = mapOf(ana);
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => (typeof input === 'string' && input.startsWith('/api/assets/') ? Promise.resolve(new Response('no', { status: 500 })) : realFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, relayOrigin) : input, init)));
    const loaded = await ana.assets.load(wanted.ref, wanted.maxSide);
    expect(loaded?.mime).toBe('image/png');
    expect(assetsServed(0).some(([served, to]) => served === hash && to === anaId)).toBe(true);
    const lines = (): number => ana.log.snapshot().entries.filter((entry) => JSON.stringify(entry).includes('Image sent by the GM directly') || JSON.stringify(entry).includes('图片改由主持人直接发送')).length;
    expect(lines()).toBe(1);
    await ana.assets.load(wanted.ref, wanted.maxSide);
    expect(lines()).toBe(1);
  }, 60_000);

  it('pauses: the player is told, a move is refused and the token stays; unpausing lets a move land; a reconnect while paused is paused again', async () => {
    const game = await boot({}, scene('hero'));
    const { ana } = await anaWithHero(game);
    const sceneId = ana.store.getState().scene?.id ?? '';
    const [heroId = ''] = [...ana.store.getState().mine];
    const heroAt = (): number | undefined => ana.store.getState().tokens.find((entry) => entry.id === heroId)?.x;
    expect(heroAt()).toBe(105);

    game.table.pause.set(true);
    await vi.waitFor(() => expect(ana.store.getState().paused).toBe(true), { timeout: 10_000 });
    expect(ana.send({ t: 'move', scene: sceneId, id: heroId, x: 245, y: 100 })).toBe(true);
    await vi.waitFor(() => expect(ana.store.getState().refused).toMatchObject({ id: heroId, reason: 'paused' }), { timeout: 10_000 });
    expect(heroAt()).toBe(105);
    expect(game.tab.store.getState().objects.tokens.hero?.x).toBe(105);

    // A second connection (the same player key, a new socket) hears the pause after its client message.
    const again = game.join('ana');
    await vi.waitFor(() => expect(again.store.getState().status.kind).toBe('joined'), { timeout: 10_000 });
    await vi.waitFor(() => expect(again.store.getState().paused).toBe(true), { timeout: 10_000 });

    game.table.pause.set(false);
    await vi.waitFor(() => expect(ana.store.getState().paused).toBe(false), { timeout: 10_000 });
    expect(ana.send({ t: 'move', scene: sceneId, id: heroId, x: 245, y: 100 })).toBe(true);
    await vi.waitFor(() => expect(game.tab.store.getState().objects.tokens.hero?.x).not.toBe(105), { timeout: 10_000 });
  }, 60_000);
});
