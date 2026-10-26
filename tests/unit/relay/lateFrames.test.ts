import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { Client, CODE, createTable, gmOf, playerOf } from './playerHarness.ts';
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

describe('a table that ended', () => {
  it('welcomes nobody afterwards and keeps no state for it', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const late = new Client(relay.origin, sockets, { origin: TEST_PUBLIC_ORIGIN });
    await late.opened;
    expect(relay.links.peek(CODE)?.sockets.size).toBe(1);
    // The table ends and, in the same tick, the open socket says hello: the close frame has not reached it yet.
    relay.tables.end(CODE);
    late.socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'player', name: 'Ann' }));
    expect(await late.closed).toBe(CLOSE.ended);
    expect(late.types()).not.toContain('welcome');
    expect(relay.links.peek(CODE)).toBeUndefined();
  });

  it('gives a GM hello on a socket that was open when the table ended no welcome either', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const late = new Client(relay.origin, sockets);
    await late.opened;
    relay.tables.end(CODE);
    late.socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'gm', secret, level: 7 }));
    await late.closed;
    expect(late.types()).not.toContain('welcome');
    expect(relay.links.peek(CODE)).toBeUndefined();
  });
});

describe('the join gate over sockets', () => {
  it('tells the GM once when a pause starts, not for every hello the pause turns away', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    await gm.send({ t: 'gate', code: '123456', ask: false });
    for (let attempt = 0; attempt < 8; attempt += 1) await playerOf(relay.origin, sockets, { code: '000000' }).closed;
    await gm.frameOf('gate-paused');
    await gm.sync();
    expect(gm.types().filter((type) => type === 'gate-paused')).toHaveLength(1);
  });

  it('tells a GM who arrives while a pause runs', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    await gm.send({ t: 'gate', code: '123456', ask: false });
    for (let attempt = 0; attempt < 5; attempt += 1) await playerOf(relay.origin, sockets, { code: '000000' }).closed;
    const second = await gmOf(relay.origin, sockets, secret);
    expect(await second.frameOf('gate-paused')).toMatchObject({ t: 'gate-paused' });
  });

  it('ignores a rejected player socket afterwards: the hello timer cannot change the close code', async () => {
    const relay = await start({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 80, pingIntervalMs: 30_000 } });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    await gm.send({ t: 'gate', code: '123456', ask: false });
    const player = playerOf(relay.origin, sockets, { code: '000000' });
    expect(await player.closed).toBe(CLOSE.wrongCode);
    const seen = vi.spyOn(relay.links, 'playerSend');
    player.socket.send(JSON.stringify({ v: 1, t: 'send', body: {} }));
    await new Promise((done) => setTimeout(done, 200));
    expect(seen).not.toHaveBeenCalled();
  });
});
