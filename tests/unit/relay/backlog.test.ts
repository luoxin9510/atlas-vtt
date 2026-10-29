import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { Backlog, payloadOf } from '../../../apps/relay/src/backlog.ts';
import { overload, pushPayload, queuedBytes } from '../../../apps/relay/src/routing.ts';
import { CODE, joined } from './playerHarness.ts';
import { useTables } from './tableSuite.ts';

const tableSuite = useTables();
const CHUNK = 'x'.repeat(300 * 1024);

describe('a closed socket', () => {
  it('releases its queue at once', async () => {
    const { gm, relay, origin } = await tableSuite.table();
    const slow = await joined(origin, tableSuite.sockets, 'Slow');
    await gm.frameOf('player-joined');
    const server = relay.links.peek(CODE)!.players.get(slow.id)!.socket;
    slow.player.deaf();
    for (let i = 0; i < 40; i += 1) await gm.send({ t: 'send', to: slow.id, body: CHUNK });
    await vi.waitFor(() => expect(queuedBytes(server)).toBeGreaterThan(0));
    slow.player.socket.terminate();
    await vi.waitFor(() => expect(queuedBytes(server)).toBe(0));
  }, 20_000);
});

describe('a close after queued frames', () => {
  async function backlogged(count: number): Promise<{ gm: Awaited<ReturnType<ReturnType<typeof useTables>['table']>>['gm']; relay: Awaited<ReturnType<ReturnType<typeof useTables>['table']>>['relay']; id: string; player: Awaited<ReturnType<typeof joined>>['player'] }> {
    const { gm, relay, origin } = await tableSuite.table();
    const target = await joined(origin, tableSuite.sockets, 'Slow');
    await gm.frameOf('player-joined');
    const server = relay.links.peek(CODE)!.players.get(target.id)!.socket;
    target.player.deaf();
    for (let i = 0; i < count; i += 1) await gm.send({ t: 'send', to: target.id, body: CHUNK });
    await vi.waitFor(() => expect(queuedBytes(server)).toBeGreaterThan(0));
    return { gm, relay, id: target.id, player: target.player };
  }
  const games = (frames: readonly { t: string }[]): number => frames.filter((frame) => frame.t === 'game').length;

  it('delivers every queued frame before the kick', async () => {
    const { gm, player, id } = await backlogged(40);
    await gm.send({ t: 'kick', id });
    player.hear();
    expect(await player.closed).toBe(CLOSE.kicked);
    expect(games(player.frames)).toBe(40);
  }, 20_000);

  it('delivers every queued frame before the end of the table', async () => {
    const { gm, player } = await backlogged(40);
    await gm.send({ t: 'end' });
    player.hear();
    expect(await player.closed).toBe(CLOSE.ended);
    expect(games(player.frames)).toBe(40);
  }, 20_000);

  it('keeps the code of a pending kick when the socket is then shed for overload', async () => {
    const { gm, relay, id, player } = await backlogged(40);
    const server = relay.links.peek(CODE)!.players.get(id)!.socket;
    await gm.send({ t: 'kick', id });
    await vi.waitFor(() => expect(relay.links.peek(CODE)!.players.get(id)).toBeUndefined());
    overload(server);
    player.hear();
    expect(await player.closed).toBe(CLOSE.kicked);
  }, 20_000);

  it('closes within 5 s when the peer never reads, and frees the queue', async () => {
    const { gm, relay, id } = await backlogged(40);
    const server = relay.links.peek(CODE)!.players.get(id)!.socket;
    const started = Date.now();
    await gm.send({ t: 'kick', id });
    expect(server.readyState).toBe(server.OPEN);
    await vi.waitFor(() => expect(server.readyState).not.toBe(server.OPEN), { timeout: 7000, interval: 50 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4000);
    expect(Date.now() - started).toBeLessThan(6500);
    expect(queuedBytes(server)).toBe(0);
  }, 20_000);
});

const MIB = 1024 * 1024;
type Joined = Awaited<ReturnType<typeof joined>>;

async function seat(count: number, overrides: Parameters<typeof tableSuite.table>[0]): Promise<{ gm: Awaited<ReturnType<typeof tableSuite.table>>['gm']; relay: Awaited<ReturnType<typeof tableSuite.table>>['relay']; seats: Joined[] }> {
  const { gm, relay, origin } = await tableSuite.table(overrides);
  const seats: Joined[] = [];
  for (let i = 0; i < count; i += 1) {
    seats.push(await joined(origin, tableSuite.sockets, `P${i}`));
    seats[i]?.player.deaf();
  }
  await gm.frameOf('player-joined', count - 1);
  return { gm, relay, seats };
}
const left = (gm: { frames: readonly { t: string; id?: unknown }[] }, id: string): boolean => gm.frames.some((frame) => frame.t === 'player-left' && frame.id === id);

describe('the relay-wide budget', () => {
  it('counts a broadcast once, not once per player, and returns to 0 when the sockets go', async () => {
    const { gm, relay, seats } = await seat(8, { maxTotalBacklogBytes: 64 * MIB });
    for (let i = 0; i < 60; i += 1) await gm.send({ t: 'send', to: '*', body: CHUNK });
    const servers = seats.map(({ id }) => relay.links.peek(CODE)!.players.get(id)!.socket);
    await vi.waitFor(() => expect(servers.every((server) => queuedBytes(server) > 0)).toBe(true));
    const each = Math.max(...servers.map(queuedBytes));
    const total = relay.links.backlog.bytes;
    expect(total).toBeGreaterThanOrEqual(each);
    expect(total).toBeLessThanOrEqual(60 * CHUNK.length * 1.01);
    expect(servers.reduce((sum, server) => sum + queuedBytes(server), 0)).toBeGreaterThan(total * 4);
    expect(relay.links.peek(CODE)!.players.size).toBe(8);
    for (const { player } of seats) player.socket.terminate();
    await vi.waitFor(() => expect(relay.links.backlog.bytes).toBe(0));
  }, 30_000);

  it('closes the player with the largest backlog 1013, sparing the other player and the GM', async () => {
    const { gm, relay, seats } = await seat(2, { maxTotalBacklogBytes: 4 * MIB });
    const [a, b] = seats as [Joined, Joined];
    const closing = vi.spyOn(relay.links.peek(CODE)!.players.get(b.id)!.socket, 'close');
    for (let i = 0; i < 200 && closing.mock.calls.length === 0; i += 1) {
      await gm.send({ t: 'send', to: b.id, body: CHUNK });
      if (i % 8 === 0) await gm.send({ t: 'send', to: a.id, body: CHUNK });
    }
    await vi.waitFor(() => expect(left(gm, b.id)).toBe(true), { timeout: 10_000 });
    expect(left(gm, a.id)).toBe(false);
    expect(relay.links.peek(CODE)!.players.has(a.id)).toBe(true);
    expect(relay.links.peek(CODE)!.gm).not.toBeNull();
    expect(closing).toHaveBeenCalledWith(1013);
    expect(relay.links.backlog.bytes).toBeLessThanOrEqual(4 * MIB);
  }, 30_000);
});

describe('Backlog accounting', () => {
  const fake = (queued: number): { socket: never; box: { queued: number } } => ({ socket: { bufferedAmount: 0 } as never, box: { queued } });

  it('counts a shared payload once and frees it with its last holder, without a double release', () => {
    const budget = new Backlog(100);
    const shared = payloadOf('x'.repeat(60));
    const [one, two] = [fake(60), fake(60)];
    budget.hold(one.socket, one.box, shared);
    budget.hold(two.socket, two.box, shared);
    expect(budget.bytes).toBe(60);
    budget.release(shared);
    expect(budget.bytes).toBe(60);
    budget.release(shared);
    budget.release(shared);
    expect(budget.bytes).toBe(0);
    expect(shared.refs).toBe(0);
  });

  it('picks the largest player first and the GM only when no player has a backlog', () => {
    const budget = new Backlog(10);
    const [gm, small, big] = [fake(900), fake(10), fake(50)];
    budget.markGm(gm.socket);
    for (const one of [gm, small, big]) budget.hold(one.socket, one.box, payloadOf('x'.repeat(one.box.queued)));
    expect(budget.victim()).toBe(big.socket);
    budget.forget(big.socket);
    expect(budget.victim()).toBe(small.socket);
    budget.forget(small.socket);
    expect(budget.victim()).toBe(gm.socket);
    budget.forget(gm.socket);
    expect(budget.victim()).toBeNull();
  });
});

describe('the budget and idle sockets', () => {
  function fake(): { socket: WebSocket; close: ReturnType<typeof vi.fn>; sent: Array<() => void>; buffered(amount: number): void } {
    const close = vi.fn();
    const sent: Array<() => void> = [];
    const state = { readyState: 1, bufferedAmount: 0, close, terminate: vi.fn(), send: (_text: string, done: () => void): void => void sent.push(done) };
    return { socket: state as unknown as WebSocket, close, sent, buffered: (amount) => void (state.bufferedAmount = amount) };
  }

  it('closes the GM with 1013, and no idle player, when the GM holds the backlog', () => {
    const budget = new Backlog(1 * MIB);
    const limits = { perSocket: 64 * MIB, budget };
    const players = [fake(), fake()];
    for (const player of players) {
      // The player had a queue once, and it has drained since.
      pushPayload(player.socket, payloadOf('hello'), limits);
      player.buffered(2 * MIB);
      pushPayload(player.socket, payloadOf('late'), limits);
      player.buffered(0);
      player.sent[0]?.();
    }
    expect(budget.bytes).toBe(0);
    const gm = fake();
    budget.markGm(gm.socket);
    gm.buffered(2 * MIB);
    pushPayload(gm.socket, payloadOf('x'.repeat(3 * MIB)), limits);
    expect(gm.close).toHaveBeenCalledWith(1013);
    for (const player of players) expect(player.close).not.toHaveBeenCalled();
    expect(budget.bytes).toBe(0);
  });
});
