import { parseGmMessage, type GmMessage, type LivePlace } from '../../../../src/app/online/protocol/index.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForkClients } from '../../../../src/app/online/gm/forkClients.ts';
import { OnlineControl } from '../../../../src/app/online/gm/OnlineControl.ts';
import { gateEntries, gateRowsOf, type GateRowActions } from '../../../../src/app/online/gm/dock/gateRows.ts';
import { PauseShare } from '../../../../src/app/online/gm/PauseShare.ts';
import { readSavedTable, type SavedTable } from '../../../../src/app/online/gm/savedTable.ts';
import { UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';
import { TOKEN_INTERVAL_MS } from '../../../../src/app/online/gm/TokenShare.ts';
import type { SceneState } from '../../../../src/app/online/gm/atlasView.ts';
import { boundOwnership, fakeCampaigns } from './fakeSeats.ts';
import { app, atlasTab, FakeSocket, png, present, workspace } from './fakeTable.ts';
import { sceneState, shareHarness, token, tokenLists, type ShareHarness } from './shareHarness.ts';
import { advanceSettled as advance } from './settled.ts';
import { useUpstreamServer } from './upstreamServer.ts';

useUpstreamServer();

vi.mock('obsidian', () => ({
  Notice: class {},
  normalizePath: (path: string) => path,
  requestUrl: () => Promise.resolve({ status: 201, json: null }),
  PluginSettingTab: class {},
  Setting: class {},
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

vi.mock('../../../../src/app/online/gm/atlasLighting.ts', async (original) => ({
  ...(await original<typeof import('../../../../src/app/online/gm/atlasLighting.ts')>()),
  accentColour: () => '#112233',
}));

const ANA = 'a'.repeat(20);
const BEN = 'b'.repeat(20);
const CAT = 'c'.repeat(20);
const ART = new Map([['maps/cave.webp', new Uint8Array([1, 2, 3])], ['art/ogre.webp', new Uint8Array([4])]]);

describe('PauseShare', () => {
  function pauseShare(levels: Record<string, number>, initial = false): { pause: PauseShare; sent: { body: GmMessage; to: string }[] } {
    const sent: { body: GmMessage; to: string }[] = [];
    const pause = new PauseShare({ players: () => Object.keys(levels), levelOf: (player) => levels[player] ?? 0, send: (body, to) => sent.push({ body, to }) }, initial);
    return { pause, sent };
  }

  it('sends pause to level-2 players only, and nothing when set to the same value', () => {
    const { pause, sent } = pauseShare({ [ANA]: 0, [BEN]: 1, [CAT]: 2 });
    pause.set(true);
    expect(sent).toEqual([{ body: { t: 'pause', paused: true }, to: CAT }]);
    pause.set(true);
    expect(sent).toHaveLength(1);
    pause.set(false);
    expect(sent.at(-1)).toEqual({ body: { t: 'pause', paused: false }, to: CAT });
    expect(sent).toHaveLength(2);
    expect(pause.paused).toBe(false);
  });

  it('sends pause after a client message, also false so a reconnect clears a stale banner', () => {
    const clients = new ForkClients((player) => pause.client(player));
    const levels = { [ANA]: 0, [CAT]: 2 };
    const { pause, sent } = pauseShare(levels, true);
    clients.receive(CAT, { t: 'client', app: 'atlas-fork-play', forkLevel: 2 });
    expect(sent).toEqual([{ body: { t: 'pause', paused: true }, to: CAT }]);
    pause.client(ANA);
    expect(sent).toHaveLength(1);
    pause.set(false);
    sent.length = 0;
    pause.client(CAT);
    expect(sent).toEqual([{ body: { t: 'pause', paused: false }, to: CAT }]);
  });

  it('calls onClient after recording the level', () => {
    const seen: [string, number, number][] = [];
    const clients: ForkClients = new ForkClients((player, level) => seen.push([player, level, clients.levelOf(player)]));
    clients.receive(CAT, { t: 'client', app: 'atlas-fork-play', forkLevel: 2 });
    expect(seen).toEqual([[CAT, 2, 2]]);
  });
});

describe('the game pause in a shared scene', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x03, 0xe8, 0, 0, 0x03, 0x20, 8, 6]);
  const scene = (): SceneState => sceneState({ background: 'maps/cave.png', objects: { ...sceneState().objects, tokens: { ogre: token('ogre', { x: 105 }) } } });

  async function table(): Promise<{ share: ShareHarness; alias: string; scene: string }> {
    const owners = boundOwnership([{ id: ANA, name: 'Ana' }]);
    owners.welcome([{ id: ANA, name: 'Ana' }]);
    owners.give(['ogre'], {}, ANA);
    const share = shareHarness(scene(), new Map([['maps/cave.png', PNG]]), owners);
    share.share.start();
    await share.set(scene());
    await share.advance(TOKEN_INTERVAL_MS);
    const list = tokenLists(share.sent).at(-1);
    return { share, alias: list?.tokens[0]?.id ?? '', scene: list?.scene ?? '' };
  }
  const refusals = (share: ShareHarness): GmMessage[] => share.sent.flatMap(({ body }) => (body.t === 'move-refused' ? [body] : []));
  const livePlaces = (share: ShareHarness): LivePlace[] => share.sent.flatMap(({ body }) => {
    const read = body.t === 'live' ? parseGmMessage(JSON.parse(JSON.stringify(body))) : null;
    return read?.t === 'live' ? read.tokens : [];
  });

  it('refuses moves while paused', async () => {
    const { share, alias, scene: id } = await table();
    share.paused = true;
    share.share.receive(ANA, { t: 'move', scene: id, id: alias, x: 735, y: 315 });
    await share.advance(TOKEN_INTERVAL_MS);
    expect(share.sent.filter(({ body }) => body.t === 'move-refused')).toEqual([{ body: { t: 'move-refused', scene: id, id: alias, x: 105, y: 100, reason: 'paused' }, to: ANA }]);
    expect(tokenLists(share.sent).at(-1)?.tokens.find((entry) => entry.id === alias)).toMatchObject({ x: 105, y: 100 });
  });

  it('refuses before the rate limit', async () => {
    const { share, alias, scene: id } = await table();
    share.paused = true;
    for (let count = 0; count < 20; count += 1) share.share.receive(ANA, { t: 'move', scene: id, id: alias, x: 735, y: 315 });
    const sent = refusals(share);
    expect(sent).toHaveLength(20);
    expect(sent.every((body) => body.t === 'move-refused' && body.reason === 'paused')).toBe(true);
  });

  it('ignores drags and drag-cancels while paused', async () => {
    const { share, alias, scene: id } = await table();
    share.paused = true;
    const before = share.sent.length;
    share.share.receive(ANA, { t: 'drag', scene: id, id: alias, x: 400, y: 300 });
    share.share.receive(ANA, { t: 'drag-cancel', scene: id, id: alias });
    await share.advance(TOKEN_INTERVAL_MS * 3);
    expect(share.sent.slice(before)).toEqual([]);
    expect(tokenLists(share.sent).at(-1)?.tokens.find((entry) => entry.id === alias)).toMatchObject({ x: 105 });
  });

  it('ends live drags on pause: the next live carries end:true and the token is back at its start', async () => {
    const { share, alias, scene: id } = await table();
    for (const x of [150, 220, 300]) {
      share.share.receive(ANA, { t: 'drag', scene: id, id: alias, x, y: 100 });
      await share.advance(40);
    }
    expect(livePlaces(share).some((place) => place.id === alias && place.end === true)).toBe(false);
    share.paused = true;
    share.share.cancelDrags();
    await share.advance(TOKEN_INTERVAL_MS);
    expect(livePlaces(share).filter((place) => place.id === alias && place.end === true)).toEqual([{ id: alias, x: 105, y: 100, end: true }]);
    expect(tokenLists(share.sent).at(-1)?.tokens.find((entry) => entry.id === alias)).toMatchObject({ x: 105 });
  });
});

describe('the game pause across a reload', () => {
  const SAVED: SavedTable = { origin: UPSTREAM_RELAY_ORIGIN, code: 'a'.repeat(26), secret: 's'.repeat(43), maxPlayers: 12, campaignId: 'c1', mapPath: 'Scenes/Cave.atlasmap', gate: { code: '483912', requireCode: true, askToJoin: true } };
  workspace.files = new Map<string, Uint8Array>([['maps/cave.png', png(700, 700)]]);
  let saves: (SavedTable | null)[] = [];
  const signedIn = { token: (): string | null => 'account-token', signedOutByServer: vi.fn(), refresh: vi.fn(() => Promise.resolve()) };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.all = [];
    saves = [];
    workspace.leaves = [];
    workspace.presented = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('round-trips through readSavedTable, reading true only when it is exactly true', () => {
    const raw = { ...SAVED, paused: true };
    expect(readSavedTable(raw)?.paused).toBe(true);
    expect(readSavedTable({ ...SAVED, paused: 'yes' })?.paused === true).toBe(false);
    expect(readSavedTable(SAVED)?.paused === true).toBe(false);
    expect(readSavedTable(JSON.parse(JSON.stringify(readSavedTable(raw))))?.paused).toBe(true);
  });

  it('keeps pause across a reload, saves a change, and sends pause after a client message', async () => {
    const tab = atlasTab(sceneState({ mapPath: 'Scenes/Cave.atlasmap', background: 'maps/cave.png' }));
    workspace.leaves = [tab.leaf];
    present(tab);
    const owners = boundOwnership([]);
    const online = new OnlineControl(app, owners, fakeCampaigns([]), (saved) => saves.push(saved), signedIn);
    void online.resume({ ...SAVED, paused: true });
    await advance(0);
    const socket = FakeSocket.all[0];
    if (socket === undefined) throw new Error('no socket');
    socket.relay({ t: 'welcome', role: 'gm', players: [{ id: ANA, name: 'Ana' }] });
    await advance(500);
    expect(online.table?.pause.paused).toBe(true);
    const pauses = (): { body: { paused?: boolean }; to: string | undefined }[] => socket.frames().flatMap((frame) => (frame.t === 'send' && frame.body?.t === 'pause' ? [{ body: frame.body as { paused?: boolean }, to: frame.to }] : []));
    expect(pauses()).toEqual([]);
    socket.relay({ t: 'game', from: ANA, body: { t: 'client', app: 'atlas-fork-play', forkLevel: 2 } });
    await advance(100);
    expect(pauses()).toEqual([{ body: { t: 'pause', paused: true }, to: ANA }]);
    online.table?.pause.set(false);
    expect(saves.at(-1)?.paused).toBe(false);
    online.table?.pause.set(true);
    expect(saves.at(-1)?.paused).toBe(true);
  });
});

describe('the pause entry of the dock menu', () => {
  const view = { code: null, requireCode: false, askToJoin: false, paused: false, pauseArmed: false, waiting: [] };
  const run = (playPaused: boolean): { titles: (string | undefined)[]; checked: boolean | undefined; calls: boolean[] } => {
    const calls: boolean[] = [];
    const actions: GateRowActions = { newCode: () => undefined, setRequireCode: () => undefined, setAskToJoin: () => undefined, copyCode: () => Promise.resolve(true), setPlayPaused: (on) => void calls.push(on) };
    const entries = gateEntries(gateRowsOf(view, playPaused), actions);
    const entry = entries.find((candidate) => candidate.title === 'Pause game');
    entry?.run();
    return { titles: entries.map((candidate) => candidate.title), checked: entry?.checked, calls };
  };

  it('is a checked entry that switches the game pause', () => {
    expect(run(false)).toMatchObject({ checked: false, calls: [true] });
    expect(run(true)).toMatchObject({ checked: true, calls: [false] });
  });
});
