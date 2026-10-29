import { describe, expect, it } from 'vitest';
import { CLOSE, PLAYER_ID_PATTERN, SECRET_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { Client, joined, playerOf } from './playerHarness.ts';
import { useTables } from './tableSuite.ts';

const { sockets, table } = useTables();

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
    const { origin, gm } = await table({ timing: { knockWaitMs: 150, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 30_000, stallMs: 30_000 } });
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

describe('a pause and the GM\'s new code', () => {
  const LONG_PAUSE = { knockWaitMs: 500, wrongCodeWindowMs: 60_000, wrongCodePauseMs: 60_000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 30_000, stallMs: 30_000 };

  async function paused(): Promise<Awaited<ReturnType<typeof table>>> {
    const t = await table({ timing: LONG_PAUSE });
    await t.gm.send({ t: 'gate', code: '123456', ask: false });
    for (let attempt = 0; attempt < 5; attempt += 1) await playerOf(t.origin, sockets, { code: '000000' }).closed;
    await t.gm.frameOf('gate-paused');
    return t;
  }

  it('accepts a newcomer with the GM\'s new code right after a pause', async () => {
    const { origin, gm } = await paused();
    expect(await playerOf(origin, sockets, { code: '123456' }).closed).toBe(CLOSE.paused);
    await gm.send({ t: 'gate', code: '654321', ask: false });
    const player = playerOf(origin, sockets, { code: '654321' });
    expect((await player.frameOf('welcome')).role).toBe('player');
  });

  it('keeps the pause when the GM sends the same code again (a reconnect)', async () => {
    const { origin, gm } = await paused();
    await gm.send({ t: 'gate', code: '123456', ask: false });
    await gm.sync();
    expect(await playerOf(origin, sockets, { code: '123456' }).closed).toBe(CLOSE.paused);
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

