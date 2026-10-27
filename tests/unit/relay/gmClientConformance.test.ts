import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { KEEPALIVE_PING, type PlayerInfo } from '../../../src/app/online/protocol/index.ts';
import type { Timers } from '../../../src/app/online/gm/companionTimers.ts';
import { TableConnection, type GateEvents, type TableStatus } from '../../../src/app/online/gm/TableConnection.ts';
import { headlessPlayer, type HeadlessPlayer } from './headlessPlayer.ts';
import { CODE, createTable } from './playerHarness.ts';
import { removeTestState, startTestRelay } from './relayHarness.ts';

/** The ws client with the Origin Obsidian's Electron sends from the GM's window. */
class ObsidianWebSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { origin: 'app://obsidian.md' } });
  }
}

/** Node's timers, as the companion's worker timers are in Obsidian (the default ones need a window). */
function nodeTimers(): Timers {
  const pending = new Map<number, NodeJS.Timeout>();
  let next = 0;
  return {
    now: () => Date.now(),
    setTimer: (run, ms) => {
      next += 1;
      const id = next;
      pending.set(id, setTimeout(() => (pending.delete(id), run()), ms));
      return id;
    },
    clearTimer: (id) => void (clearTimeout(pending.get(id)), pending.delete(id)),
  };
}

const running: Array<{ close(): Promise<void> }> = [];
const connections: TableConnection[] = [];
const players: HeadlessPlayer[] = [];
const original = globalThis.WebSocket;

beforeEach(() => {
  vi.stubGlobal('WebSocket', ObsidianWebSocket);
});

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.stop();
  for (const player of players.splice(0)) player.socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  vi.unstubAllGlobals();
  expect(globalThis.WebSocket).toBe(original);
});

interface Table {
  connection: TableConnection;
  origin: string;
  statuses: TableStatus[];
  games: Array<{ from: string; body: unknown }>;
  knocks: PlayerInfo[];
  socket(): ObsidianWebSocket;
}

async function table(): Promise<Table> {
  const relay = await startTestRelay();
  running.push(relay);
  const { origin } = relay;
  const secret = await createTable(origin);
  const statuses: TableStatus[] = [];
  const games: Table['games'] = [];
  const knocks: PlayerInfo[] = [];
  let connection!: TableConnection;
  const gate: GateEvents = {
    frame: () => ({ code: '123456', ask: true }),
    welcomed: () => undefined,
    // As the GM's card does once it has stood long enough: the client's own admit API.
    knocked: (player) => (knocks.push(player), connection.answer(player.id, true)),
    gone: () => undefined,
    paused: () => undefined,
  };
  connection = new TableConnection(origin, CODE, secret, {
    status: (status) => statuses.push(status), welcome: () => undefined, joined: () => undefined, left: () => undefined,
    message: (from, body) => games.push({ from, body }), access: () => undefined,
  }, gate, nodeTimers());
  connections.push(connection);
  connection.start();
  return { connection, origin, statuses, games, knocks, socket: () => (connection as unknown as { socket: ObsidianWebSocket }).socket };
}

describe('the relay with the GM\'s own TableConnection', () => {
  it('welcomes the real GM client from the Obsidian origin', async () => {
    const { statuses } = await table();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('online'));
  });

  it('admits a newcomer who knocks with the join code, and carries messages both ways', async () => {
    const { connection, origin, statuses, games, knocks } = await table();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('online'));

    const player = await headlessPlayer(origin, CODE, { name: 'Ann', code: '123456' });
    players.push(player);
    const { id, key } = await player.welcome;
    expect(knocks).toEqual([{ id: expect.any(String), name: 'Ann' }]);
    expect(key).toMatch(/\S/);
    await vi.waitFor(() => expect(connection.connected.has(id)).toBe(true));

    connection.send({ t: 'scene', scene: null }, id);
    await vi.waitFor(() => expect(player.messages).toEqual([{ t: 'scene', scene: null }]));

    const roll = { t: 'roll', scene: 's1', formula: '1d20', token: null } as const;
    player.send(roll);
    await vi.waitFor(() => expect(games).toEqual([{ from: id, body: roll }]));
  });

  it('gets the relay\'s pong for its own ping', async () => {
    const { statuses, socket } = await table();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('online'));
    const ws = socket();
    const pong = new Promise<string>((done) => ws.on('message', (data) => String(data) === 'pong' && done('pong')));
    ws.send(KEEPALIVE_PING);
    await expect(pong).resolves.toBe('pong');
  });
});
