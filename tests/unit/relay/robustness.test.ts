import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { Client, CODE, createTable, gmOf, joined } from './playerHarness.ts';
import { removeTestState, startTestRelay, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const running: Array<{ close(): Promise<void> }> = [];
const sockets: WebSocket[] = [];
const raw: Socket[] = [];
const FAST_PING = { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 250, stallMs: 30_000 };
const CHUNK = 'x'.repeat(300 * 1024);

async function start(...args: Parameters<typeof startTestRelay>): ReturnType<typeof startTestRelay> {
  const relay = await startTestRelay(...args);
  running.push(relay);
  return relay;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const socket of raw.splice(0)) socket.destroy();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

function upgradeRequest(code: string, port: number): string {
  return `GET /api/tables/${code}/socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
}

/** A TCP client that keeps its own half open after the server has finished writing. */
function halfOpenClient(port: number, request: string): Socket {
  const socket = connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => socket.write(request));
  socket.on('error', () => undefined);
  // Never reads: the server's FIN is not even seen, and this side never closes.
  raw.push(socket);
  return socket;
}

/** A player whose link delivers `rate` bytes a second: its TCP socket is read in 100 ms slices. */
function slowReader(client: Client, rate: number): () => void {
  const tcp = (client.socket as unknown as { _socket: Socket })._socket;
  let budget = 0;
  tcp.on('data', (bytes: Buffer) => {
    budget -= bytes.length;
    if (budget <= 0) tcp.pause();
  });
  const tick = setInterval(() => {
    budget = rate / 10;
    tcp.resume();
  }, 100);
  tcp.pause();
  return () => clearInterval(tick);
}

describe('backpressure (I1, N2)', () => {
  const STALL = { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 30_000, stallMs: 5000 };

  it('lets a slow player that keeps reading receive a 30 MB asset completely', async () => {
    const relay = await start({ timing: STALL });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    const slow = await joined(relay.origin, sockets, 'Slow');
    const stop = slowReader(slow.player, 10_000_000);
    try {
      for (let i = 0; i < 100; i += 1) await gm.send({ t: 'send', to: slow.id, body: CHUNK });
      await vi.waitFor(() => expect(slow.player.frames.filter((frame) => frame.t === 'game')).toHaveLength(100), { timeout: 20_000 });
      expect(relay.links.peek(CODE)?.players.has(slow.id)).toBe(true);
    } finally {
      stop();
    }
  }, 40_000);

  it('closes a player that stops reading only after the stall window, and spares the GM and the other players', async () => {
    const relay = await start({ timing: STALL });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    const stuck = await joined(relay.origin, sockets, 'Stuck');
    const fine = await joined(relay.origin, sockets, 'Fine');
    await gm.frameOf('player-joined', 1);
    stuck.player.deaf();
    const received = (): number => fine.player.frames.filter((frame) => frame.t === 'game').length;
    for (let i = 0; i < 140; i += 1) {
      await gm.send({ t: 'send', to: '*', body: CHUNK });
      if (i % 4 === 3) await vi.waitFor(() => expect(received()).toBe(i + 1), { timeout: 12_000 });
    }
    // 42 MB are queued for the stuck player: no limit but the stall window has been reached. The window (5 s)
    // is far longer than this send loop takes, even under load, so the player must still be here.
    expect(relay.links.peek(CODE)?.players.has(stuck.id)).toBe(true);
    await vi.waitFor(() => expect(gm.frames.filter((frame) => frame.t === 'player-left' && frame.id === stuck.id)).toHaveLength(1), { timeout: 12_000 });
    expect(relay.links.peek(CODE)?.players.has(fine.id)).toBe(true);
    expect(relay.links.peek(CODE)?.gm).not.toBeNull();
  }, 40_000);

  it('closes a player at once whose backlog passes the hard cap, stall window or not', async () => {
    const relay = await start({ maxBacklogBytes: 4 * 1024 * 1024 });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    const stuck = await joined(relay.origin, sockets, 'Stuck');
    await gm.frameOf('player-joined');
    stuck.player.deaf();
    for (let i = 0; i < 80; i += 1) await gm.send({ t: 'send', to: '*', body: CHUNK });
    await vi.waitFor(() => expect(gm.frames.filter((frame) => frame.t === 'player-left' && frame.id === stuck.id)).toHaveLength(1), { timeout: 12_000 });
  }, 40_000);
});

describe('liveness (I2)', () => {
  it('terminates a player that no longer answers pings, and keeps one that does', async () => {
    const relay = await start({ timing: FAST_PING });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    const dead = await joined(relay.origin, sockets, 'Dead');
    const alive = await joined(relay.origin, sockets, 'Alive');
    await gm.frameOf('player-joined', 1);
    dead.player.deaf();
    await vi.waitFor(() => expect(gm.frames.filter((frame) => frame.t === 'player-left' && frame.id === dead.id)).toHaveLength(1), { timeout: 3000 });
    expect(relay.links.peek(CODE)?.players.has(alive.id)).toBe(true);
    expect(gm.frames.some((frame) => frame.t === 'player-left' && frame.id === alive.id)).toBe(false);
  });

  it('keeps a slow reader that sends nothing while its backlog is still draining, though its pong is stuck behind it', async () => {
    const relay = await start({ timing: { ...FAST_PING, pingIntervalMs: 600 } });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    const slow = await joined(relay.origin, sockets, 'Slow');
    await gm.frameOf('player-joined');
    const stop = slowReader(slow.player, 3_000_000);
    try {
      for (let i = 0; i < 60; i += 1) await gm.send({ t: 'send', to: slow.id, body: CHUNK });
      // Four ping intervals: the ping (and so the pong) waits behind 18 MB that take about 6 s to read.
      await new Promise((done) => setTimeout(done, 2500));
      expect(relay.links.peek(CODE)?.players.has(slow.id)).toBe(true);
    } finally {
      stop();
    }
  }, 20_000);

  it('terminates a GM that no longer answers pings, so the table is unhosted again', async () => {
    const relay = await start({ timing: FAST_PING });
    const secret = await createTable(relay.origin);
    const gm = await gmOf(relay.origin, sockets, secret);
    expect(relay.links.peek(CODE)?.gm).not.toBeNull();
    gm.deaf();
    await vi.waitFor(() => expect(relay.links.peek(CODE)?.gm).toBeNull(), { timeout: 3000 });
  });
});

describe('refused upgrades (I3)', () => {
  it('destroys the socket after a 404 even when the client keeps its half open', async () => {
    const relay = await start();
    const { port } = new URL(relay.origin);
    for (let i = 0; i < 10; i += 1) halfOpenClient(Number(port), upgradeRequest('b'.repeat(26), Number(port)));
    // The requests are answered at once; give the relay time to have refused all of them.
    await new Promise((done) => setTimeout(done, 400));
    expect(await relay.openConnections()).toBe(0);
  });

  it('destroys the socket after a 429 when the client keeps its half open', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const { port } = new URL(relay.origin);
    for (let i = 0; i < 20; i += 1) {
      const client = new Client(relay.origin, sockets);
      await client.opened;
    }
    const before = await relay.openConnections();
    for (let i = 0; i < 5; i += 1) halfOpenClient(Number(port), upgradeRequest(CODE, Number(port)));
    await new Promise((done) => setTimeout(done, 400));
    expect(await relay.openConnections()).toBe(before);
  });
});

describe('POST /api/tables bodies (M7)', () => {
  /** Streams a body to POST /api/tables with `headers`; true when the relay ended the connection within 1.5 s. */
  async function cutOff(headers: string, chunked = false): Promise<{ closed: boolean; status: string }> {
    const relay = await start();
    const { port } = new URL(relay.origin);
    const socket = connect({ port: Number(port), host: '127.0.0.1' });
    raw.push(socket);
    socket.on('error', () => undefined);
    let answer = '';
    socket.on('data', (bytes: Buffer) => (answer += bytes.toString('latin1')));
    const closed = new Promise<boolean>((done) => socket.once('close', () => done(true)));
    await new Promise<void>((done) => socket.once('connect', () => done()));
    socket.write(`POST /api/tables HTTP/1.1\r\nHost: x\r\n${headers}${chunked ? 'Transfer-Encoding: chunked\r\n' : 'Content-Length: 100000000\r\n'}\r\n`);
    const body = Buffer.alloc(32 * 1024, 'a');
    const piece = chunked ? Buffer.concat([Buffer.from(`${body.length.toString(16)}\r\n`), body, Buffer.from('\r\n')]) : body;
    const timer = setInterval(() => socket.write(piece), 5);
    const result = await Promise.race([closed, new Promise<boolean>((done) => setTimeout(() => done(false), 1500))]);
    clearInterval(timer);
    return { closed: result, status: answer.split('\r\n')[0] ?? '' };
  }

  it('stops reading and closes after a 401 for a wrong host key', async () => {
    const result = await cutOff(`Origin: ${TEST_PUBLIC_ORIGIN}\r\nAuthorization: Bearer wrong-key-wrong-key-wrong-key\r\n`, true);
    expect(result).toMatchObject({ closed: true });
    expect(result.status).toContain('401');
  });

  it('stops reading and closes after a 403 for a wrong Origin', async () => {
    const result = await cutOff('Origin: https://evil.example.test\r\n', true);
    expect(result).toMatchObject({ closed: true });
    expect(result.status).toContain('403');
  });

  it('refuses a body that declares more than 4 KiB before looking at the key, and closes', async () => {
    const result = await cutOff(`Origin: ${TEST_PUBLIC_ORIGIN}\r\n`);
    expect(result).toMatchObject({ closed: true });
    expect(result.status).toContain('413');
  });
});

describe('unauthenticated bodies (M7)', () => {
  async function floods(path: string): Promise<boolean> {
    const relay = await start();
    const { port } = new URL(relay.origin);
    const socket = connect({ port: Number(port), host: '127.0.0.1' });
    raw.push(socket);
    socket.on('error', () => undefined);
    socket.on('data', () => undefined);
    const closed = new Promise<boolean>((done) => socket.once('close', () => done(true)));
    await new Promise<void>((done) => socket.once('connect', () => done()));
    socket.write(`POST ${path} HTTP/1.1\r\nHost: x\r\nOrigin: ${TEST_PUBLIC_ORIGIN}\r\nContent-Length: 100000000\r\n\r\n`);
    const chunk = Buffer.alloc(64 * 1024, 'a');
    const timer = setInterval(() => socket.write(chunk), 5);
    const result = await Promise.race([closed, new Promise<boolean>((done) => setTimeout(() => done(false), 1500))]);
    clearInterval(timer);
    return result;
  }

  it('ends the connection of a client that streams a large body to /api/reports', async () => {
    expect(await floods('/api/reports')).toBe(true);
  });

  it('ends the connection of a client that streams a large body to /api/feedback', async () => {
    expect(await floods('/api/feedback')).toBe(true);
  });

  it('ends the connection of a client that streams a large body to an unknown path', async () => {
    expect(await floods('/api/nothing')).toBe(true);
  });

  it('still answers 204 to a small report', async () => {
    const relay = await start();
    const response = await fetch(`${relay.origin}/api/reports`, { method: 'POST', body: '{"a":1}' });
    expect(response.status).toBe(204);
  });
});

