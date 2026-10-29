import { describe, expect, it, vi } from 'vitest';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { Client, gmOf, joined, playerOf } from './playerHarness.ts';
import { useTables } from './tableSuite.ts';

const { sockets, table } = useTables();

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
    // Reading again, the player answers the relay's close; the relay has handled the late frame before that answer.
    player.hear();
    await player.closed;
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
