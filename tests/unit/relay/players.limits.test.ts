import { describe, expect, it } from 'vitest';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { Client, CODE, joined, playerOf } from './playerHarness.ts';
import { TEST_PUBLIC_ORIGIN } from './relayHarness.ts';
import { useTables } from './tableSuite.ts';

const { sockets, table } = useTables();

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
    const { origin } = await table({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 150, pingIntervalMs: 30_000, stallMs: 30_000 } });
    expect(await new Client(origin, sockets).closed).toBe(CLOSE.protocol);
  });

  it('does not close a welcomed player when the hello timeout passes', async () => {
    const { origin } = await table({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 150, pingIntervalMs: 30_000, stallMs: 30_000 } });
    const { player } = await joined(origin, sockets);
    await new Promise((done) => setTimeout(done, 300));
    expect(player.socket.readyState).toBe(1);
  });

  it('checks Origin exactly for players; the GM socket needs none', async () => {
    const { origin } = await table();
    const ok = playerOf(origin, sockets, {}, { origin: TEST_PUBLIC_ORIGIN });
    expect((await ok.frameOf('welcome')).role).toBe('player');
    for (const bad of ['https://play.example.test:8443', 'http://play.example.test', 'https://other.example.test']) {
      expect(await playerOf(origin, sockets, {}, { origin: bad }).closed).toBe(CLOSE.badOrigin);
    }
    expect(await playerOf(origin, sockets, {}, {}).closed).toBe(CLOSE.badOrigin);
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
