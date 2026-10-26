import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { CLOSE, PLAYER_ID_PATTERN, SECRET_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { Client, CODE, createTable, gmOf, joined, playerOf } from './playerHarness.ts';
import { removeTestState, startTestRelay, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const running: Array<{ close(): Promise<void> }> = [];
const sockets: WebSocket[] = [];

async function start(...args: Parameters<typeof startTestRelay>): ReturnType<typeof startTestRelay> {
  const relay = await startTestRelay(...args);
  running.push(relay);
  return relay;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  vi.restoreAllMocks();
});

async function table(overrides: Parameters<typeof startTestRelay>[0] = {}): Promise<{ origin: string; gm: Client; secret: string; relay: Awaited<ReturnType<typeof start>> }> {
  const relay = await start(overrides);
  const secret = await createTable(relay.origin);
  return { origin: relay.origin, gm: await gmOf(relay.origin, sockets, secret), secret, relay };
}

describe('join gate over sockets', () => {
  it('knocks, and an admit gives the player welcome first and the GM player-joined', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: true });
    const player = playerOf(origin, sockets, { code: '123456', name: 'Mira', waits: true });
    const waiting = await player.frameOf('waiting');
    expect(String(waiting.wait)).toMatch(SECRET_PATTERN);
    const knock = await gm.frameOf('knock');
    expect(knock).toEqual({ v: 1, t: 'knock', id: expect.stringMatching(PLAYER_ID_PATTERN), name: 'Mira' });
    await gm.send({ t: 'admit', id: knock.id });
    expect(await player.frameOf('welcome')).toEqual({ v: 1, t: 'welcome', role: 'player', id: knock.id, key: expect.stringMatching(SECRET_PATTERN), gmOnline: true });
    expect(await gm.frameOf('player-joined')).toEqual({ v: 1, t: 'player-joined', id: knock.id, name: 'Mira' });
  });

  it('closes a declined knock with 4012', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: true });
    const player = playerOf(origin, sockets, { code: '123456' });
    const knock = await gm.frameOf('knock');
    await gm.send({ t: 'decline', id: knock.id });
    expect(await player.closed).toBe(CLOSE.declined);
  });

  it('closes an unanswered knock with 4013 and tells the GM knock-gone', async () => {
    const { origin, gm } = await table({ timing: { knockWaitMs: 150, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000 } });
    await gm.send({ t: 'gate', code: '123456', ask: true });
    const player = playerOf(origin, sockets, { code: '123456' });
    const knock = await gm.frameOf('knock');
    expect(await player.closed).toBe(CLOSE.noAnswer);
    expect(await gm.frameOf('knock-gone')).toEqual({ v: 1, t: 'knock-gone', id: knock.id });
  });

  it('takes a wait up again with its token on a new socket', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: true });
    const first = playerOf(origin, sockets, { code: '123456', waits: true });
    const wait = (await first.frameOf('waiting')).wait as string;
    const knock = await gm.frameOf('knock');
    const second = playerOf(origin, sockets, { wait });
    expect((await second.frameOf('waiting')).wait).toBe(wait);
    expect(await first.closed).toBe(CLOSE.replaced);
    await gm.send({ t: 'admit', id: knock.id });
    expect((await second.frameOf('welcome')).id).toBe(knock.id);
    expect(gm.types().filter((type) => type === 'knock')).toHaveLength(1);
  });

  it('tells the GM about a knock that gives up before an answer', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: true });
    const player = playerOf(origin, sockets, { code: '123456' });
    const knock = await gm.frameOf('knock');
    player.socket.close();
    expect(await gm.frameOf('knock-gone')).toEqual({ v: 1, t: 'knock-gone', id: knock.id });
  });

  it('answers an admit into a full table with knock-gone full and 4003', async () => {
    const { origin, gm } = await table({ maxPlayers: 1 });
    await gm.send({ t: 'gate', code: null, ask: true });
    const first = playerOf(origin, sockets, {});
    const second = playerOf(origin, sockets, {});
    const [a, b] = [await gm.frameOf('knock', 0), await gm.frameOf('knock', 1)];
    await gm.send({ t: 'admit', id: a.id });
    await first.frameOf('welcome');
    await gm.send({ t: 'admit', id: b.id });
    expect(await second.closed).toBe(CLOSE.full);
    expect(await gm.frameOf('knock-gone')).toEqual({ v: 1, t: 'knock-gone', id: b.id, full: true });
  });

  it('resolves a roster seat code to the seat id', async () => {
    const { origin, gm } = await table();
    const seat = { id: 'q'.repeat(20), name: 'Seat', code: '654321' };
    await gm.send({ t: 'gate', code: '123456', ask: true });
    await gm.send({ t: 'players', players: [seat] });
    const player = playerOf(origin, sockets, { code: '654321', name: 'Whoever' });
    expect(await player.frameOf('welcome')).toMatchObject({ id: seat.id, gmOnline: true });
    expect(await gm.frameOf('player-joined')).toMatchObject({ id: seat.id, name: 'Seat' });
  });

  it('pauses after five wrong codes: 4011, and gate-paused to the GM', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: false });
    for (let attempt = 0; attempt < 4; attempt += 1) expect(await playerOf(origin, sockets, { code: '000000' }).closed).toBe(CLOSE.wrongCode);
    expect(await playerOf(origin, sockets, { code: '000000' }).closed).toBe(CLOSE.paused);
    expect(await gm.frameOf('gate-paused')).toMatchObject({ t: 'gate-paused', until: expect.any(Number) });
  });
});

describe('welcome lists', () => {
  it('lists connected players and waiting knocks in a GM welcome', async () => {
    const { origin, gm, secret } = await table();
    const { id } = await joined(origin, sockets, 'Ann');
    await gm.send({ t: 'gate', code: null, ask: true });
    const waiting = playerOf(origin, sockets, { name: 'Bo' });
    const knock = await gm.frameOf('knock');
    const again = new Client(origin, sockets);
    await again.send({ t: 'hello', role: 'gm', secret, level: 7 });
    expect(await again.frameOf('welcome')).toEqual({ v: 1, t: 'welcome', role: 'gm', players: [{ id, name: 'Ann' }], waiting: [{ id: knock.id, name: 'Bo' }], batch: true });
    expect(waiting.socket.readyState).toBe(1);
  });
});

describe('routing', () => {
  it('forwards a player send to the GM as game with from, the body untouched', async () => {
    const { origin, gm } = await table();
    const { player, id } = await joined(origin, sockets);
    const body = { t: 'whatever', n: [1, { x: 'y' }] };
    await player.send({ t: 'send', body });
    expect(await gm.frameOf('game')).toEqual({ v: 1, t: 'game', from: id, body });
  });

  it('sends GM messages to one player, to all with *, and sends batches', async () => {
    const { origin, gm } = await table();
    const ann = await joined(origin, sockets, 'Ann');
    const bo = await joined(origin, sockets, 'Bo');
    await gm.send({ t: 'send', to: ann.id, body: 'only-ann' });
    await gm.send({ t: 'send', to: '*', body: 'everyone' });
    await gm.send({ t: 'sends', sends: [{ to: bo.id, body: 'b1' }, { to: '*', body: 'all2' }] });
    await vi.waitFor(() => expect(ann.player.frames.filter((frame) => frame.t === 'game')).toHaveLength(3));
    await vi.waitFor(() => expect(bo.player.frames.filter((frame) => frame.t === 'game')).toHaveLength(3));
    const bodies = (client: Client): unknown[] => client.frames.filter((frame) => frame.t === 'game').map((frame) => frame.body);
    expect(bodies(ann.player)).toEqual(['only-ann', 'everyone', 'all2']);
    expect(bodies(bo.player)).toEqual(['everyone', 'b1', 'all2']);
    expect(ann.player.frames.find((frame) => frame.t === 'game')).toEqual({ v: 1, t: 'game', body: 'only-ann' });
  });

  it('kicks with 4009, forgets the key and ignores the kicked player afterwards', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: false });
    const player = playerOf(origin, sockets, { code: '123456' });
    const welcome = await player.frameOf('welcome');
    player.deaf();
    await gm.send({ t: 'kick', id: welcome.id });
    await vi.waitFor(() => expect(gm.types()).toContain('player-left'));
    player.socket.send(JSON.stringify({ v: 1, t: 'send', body: 'late' }));
    await new Promise((done) => setTimeout(done, 150));
    expect(gm.frames.filter((frame) => frame.t === 'game')).toEqual([]);
    const retry = playerOf(origin, sockets, { key: welcome.key });
    expect(await retry.closed).toBe(CLOSE.wrongCode);
  });

  it('closes a kick with 4009', async () => {
    const { origin, gm } = await table();
    const { player, id } = await joined(origin, sockets);
    await gm.send({ t: 'kick', id });
    expect(await player.closed).toBe(CLOSE.kicked);
  });

  it('lets a returning player in on their key, replacing the old socket with 4002', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'gate', code: '123456', ask: false });
    const first = playerOf(origin, sockets, { code: '123456' });
    const welcome = await first.frameOf('welcome');
    const second = playerOf(origin, sockets, { key: welcome.key });
    expect(await second.frameOf('welcome')).toMatchObject({ id: welcome.id, key: welcome.key });
    expect(await first.closed).toBe(CLOSE.replaced);
    await vi.waitFor(() => expect(gm.frames.filter((frame) => frame.t === 'player-joined')).toHaveLength(2));
    expect(gm.types()).not.toContain('player-left');
  });

  it('keeps player keys over a restart, as hashes only', async () => {
    const first = await start();
    const secret = await createTable(first.origin);
    const { key, id, player: before } = await joined(first.origin, sockets);
    const gm = await gmOf(first.origin, sockets, secret);
    await first.close();
    running.splice(running.indexOf(first), 1);
    // The first relay's late writes (the GM unhosting) must be done before a second one uses the file.
    await Promise.all([gm.closed, before.closed]);
    await vi.waitFor(() => expect(first.links.stateOf(CODE).sockets.size).toBe(0));
    await first.tables.flush();
    const { readFileSync } = await import('node:fs');
    const saved = readFileSync(first.config.statePath, 'utf8');
    expect(saved).not.toContain(key);
    const second = await start({ statePath: first.config.statePath });
    const player = playerOf(second.origin, sockets, { key });
    expect(await player.frameOf('welcome')).toMatchObject({ id, key, gmOnline: false });
  });

  it('tells players gm offline when the GM goes and online when one is welcomed', async () => {
    const { origin, gm, secret } = await table();
    const { player } = await joined(origin, sockets);
    gm.socket.close();
    expect(await player.frameOf('gm', 0)).toEqual({ v: 1, t: 'gm', online: false });
    await gmOf(origin, sockets, secret);
    expect(await player.frameOf('gm', 1)).toEqual({ v: 1, t: 'gm', online: true });
  });

  it('tells the GM when a player leaves', async () => {
    const { origin, gm } = await table();
    const { player, id } = await joined(origin, sockets);
    player.socket.close();
    expect(await gm.frameOf('player-left')).toEqual({ v: 1, t: 'player-left', id });
  });

  it('closes a player of an ended table with 4008 and ignores its frames after', async () => {
    const { origin, gm } = await table();
    const { player } = await joined(origin, sockets);
    await gm.send({ t: 'end' });
    expect(await player.closed).toBe(CLOSE.ended);
  });
});

describe('player limits', () => {
  it('closes 4005 for 21 frames in a second', async () => {
    const { origin } = await table();
    const { player } = await joined(origin, sockets);
    for (let count = 0; count < 25; count += 1) player.socket.send(JSON.stringify({ v: 1, t: 'send', body: count }));
    expect(await player.closed).toBe(CLOSE.rateLimited);
  });

  it('closes 4004 for a player frame over 4 KiB', async () => {
    const { origin } = await table();
    const { player } = await joined(origin, sockets);
    player.socket.send(JSON.stringify({ v: 1, t: 'send', body: 'x'.repeat(5000) }));
    expect(await player.closed).toBe(CLOSE.tooLarge);
  });

  it('closes 4006 for a socket without an accepted hello after helloTimeoutMs', async () => {
    const { origin } = await table({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 150 } });
    expect(await new Client(origin, sockets).closed).toBe(CLOSE.protocol);
  });

  it('does not close a welcomed player when the hello timeout passes', async () => {
    const { origin } = await table({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 150 } });
    const { player } = await joined(origin, sockets);
    await new Promise((done) => setTimeout(done, 300));
    expect(player.socket.readyState).toBe(1);
  });

  it('checks Origin exactly for players; the GM socket needs none', async () => {
    const { origin } = await table();
    const ok = playerOf(origin, sockets, {}, { origin: TEST_PUBLIC_ORIGIN });
    expect((await ok.frameOf('welcome')).role).toBe('player');
    for (const bad of ['https://play.example.test:8443', 'http://play.example.test', 'https://other.example.test']) {
      expect(await playerOf(origin, sockets, {}, { origin: bad }).closed).toBe(CLOSE.protocol);
    }
    expect(await playerOf(origin, sockets, {}, {}).closed).toBe(CLOSE.protocol);
  });
});

describe('sockets per client address', () => {
  async function refusedStatus(origin: string, headers: Record<string, string>): Promise<number> {
    const { default: WebSocketClient } = await import('ws');
    const socket = new WebSocketClient(`${origin.replace('http', 'ws')}/api/tables/${CODE}/socket`, { headers });
    sockets.push(socket);
    return new Promise<number>((done) => {
      socket.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
      socket.on('open', () => done(101));
      socket.on('error', () => undefined);
    });
  }

  /** The table's GM already holds one of the 20. */
  async function fill(origin: string, headerFor: (index: number) => Record<string, string>, count = 19): Promise<void> {
    for (let index = 0; index < count; index += 1) expect(await refusedStatus(origin, headerFor(index))).toBe(101);
  }

  it('refuses the 21st socket from one address with 429', async () => {
    const { origin } = await table();
    await fill(origin, () => ({}));
    expect(await refusedStatus(origin, {})).toBe(429);
  });

  it('counts the X-Forwarded-For address with trustProxy xff', async () => {
    const { origin } = await table({ trustProxy: 'xff' });
    await fill(origin, () => ({ 'x-forwarded-for': '9.9.9.9' }), 20);
    expect(await refusedStatus(origin, { 'x-forwarded-for': '9.9.9.9' })).toBe(429);
    expect(await refusedStatus(origin, { 'x-forwarded-for': '8.8.8.8' })).toBe(101);
  });

  it('ignores X-Forwarded-For with trustProxy none', async () => {
    const { origin } = await table({ trustProxy: 'none' });
    await fill(origin, (index) => ({ 'x-forwarded-for': `7.7.7.${index}` }));
    expect(await refusedStatus(origin, { 'x-forwarded-for': '6.6.6.6' })).toBe(429);
  });
});
