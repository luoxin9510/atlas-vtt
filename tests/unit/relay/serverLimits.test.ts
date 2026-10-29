import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { crashHandlers, crashLine, installCrashHandler } from '../../../apps/relay/src/crashHandler.ts';
import { SERVER_LIMITS, type ServerLimits } from '../../../apps/relay/src/serverLimits.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const running: Array<{ close(): Promise<void> }> = [];
const sockets: Socket[] = [];
const small: ServerLimits = { ...SERVER_LIMITS, headersTimeoutMs: 200, requestTimeoutMs: 400, checkIntervalMs: 50 };

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

function rawSocket(origin: string): Socket {
  const socket = connect(Number(new URL(origin).port), '127.0.0.1');
  socket.on('error', () => undefined);
  socket.resume();
  sockets.push(socket);
  return socket;
}

const closed = (socket: Socket): Promise<void> => new Promise((done) => socket.once('close', () => done()));
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe('relay server limits', () => {
  it('pins the verbatim values', () => {
    expect(SERVER_LIMITS).toEqual({ headersTimeoutMs: 20_000, requestTimeoutMs: 300_000, keepAliveTimeoutMs: 95_000, maxConnections: 512, checkIntervalMs: 30_000 });
  });

  it('applies the limits to the HTTP server', async () => {
    const relay = await startTestRelay({}, undefined, { ...small, keepAliveTimeoutMs: 1234, maxConnections: 7 });
    running.push(relay);
    const server = relay.httpServer;
    expect([server.headersTimeout, server.requestTimeout, server.keepAliveTimeout, server.maxConnections]).toEqual([200, 400, 1234, 7]);
  });

  it('closes a connection that sends its headers slowly', async () => {
    const relay = await startTestRelay({}, undefined, small);
    running.push(relay);
    const socket = rawSocket(relay.origin);
    socket.write('GET /api/tables/x HTTP/1.1\r\nHost: x\r\n');
    await Promise.race([closed(socket), pause(3000).then(() => { throw new Error('still open'); })]);
  });

  it('drops connections over the cap', async () => {
    const relay = await startTestRelay({}, undefined, { ...small, maxConnections: 3 });
    running.push(relay);
    const held = [rawSocket(relay.origin), rawSocket(relay.origin), rawSocket(relay.origin)];
    await vi.waitFor(async () => expect(await relay.openConnections()).toBe(3));
    const extra = rawSocket(relay.origin);
    await Promise.race([closed(extra), pause(3000).then(() => { throw new Error('extra still open'); })]);
    expect(held.every((socket) => !socket.destroyed)).toBe(true);
  });

  it('keeps an upgraded WebSocket open past the request and headers timeouts', async () => {
    const relay = await startTestRelay({}, undefined, small);
    running.push(relay);
    const created = await fetch(`${relay.origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN }, body: JSON.stringify({ code: CODE }) });
    expect(created.status).toBe(201);
    const ws = new WebSocket(`${relay.origin.replace('http', 'ws')}/api/tables/${CODE}/socket`);
    ws.on('error', () => undefined);
    await new Promise<void>((done) => ws.once('open', () => done()));
    let closedEarly = false;
    ws.once('close', () => { closedEarly = true; });
    await pause(1500);
    expect(closedEarly).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });
});

describe('crash handler', () => {
  it('logs one line with name and message only, then exits with 1', () => {
    const log = vi.fn();
    const exit = vi.fn();
    const error = Object.assign(new TypeError('bad thing'), { body: 'SECRET-BODY', headers: { authorization: 'SECRET-KEY' } });
    crashHandlers(log, exit).onException(error);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('relay crashed (uncaughtException): TypeError');
    expect(String(log.mock.calls[0]?.[0])).not.toContain('bad thing');
    expect(String(log.mock.calls[0]?.[0])).not.toContain('SECRET');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('registers and removes both process handlers', () => {
    const before = [process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')];
    const remove = installCrashHandler(vi.fn(), vi.fn());
    expect([process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')]).toEqual([before[0]! + 1, before[1]! + 1]);
    remove();
    expect([process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')]).toEqual(before);
  });

  it('names a string error code but never the message', () => {
    const error = Object.assign(new Error('ENOENT: open /secret/path'), { code: 'ENOENT' });
    expect(crashLine('uncaughtException', error)).toBe('relay crashed (uncaughtException): Error ENOENT');
  });

  it('still exits when logging throws', () => {
    const exit = vi.fn();
    const log = vi.fn(() => { throw new Error('log failed'); });
    expect(() => crashHandlers(log, exit).onRejection(new Error('x'))).toThrow('log failed');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('handles a rejection with a non-error value without printing it', () => {
    expect(crashLine('unhandledRejection', { secret: 'SECRET' })).toBe('relay crashed (unhandledRejection): non-error value');
  });
});
