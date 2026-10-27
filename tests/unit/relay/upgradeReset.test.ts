import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MAX_SOCKETS_PER_ADDRESS } from '../../../apps/relay/src/limits.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const UNKNOWN = 'b'.repeat(26);
const running: Array<{ close(): Promise<void> }> = [];
const held: WebSocket[] = [];

afterEach(async () => {
  for (const socket of held.splice(0)) socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

function upgradeRequest(code: string, port: number): string {
  return `GET /api/tables/${code}/socket HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
}

/** Sends an upgrade request and resets the connection at once, as a peer that vanishes would. */
async function resetAfterUpgrade(origin: string, code: string, times: number): Promise<void> {
  const { port } = new URL(origin);
  const sockets: Socket[] = [];
  for (let i = 0; i < times; i++) {
    const socket = connect(Number(port), '127.0.0.1');
    socket.on('error', () => undefined);
    socket.on('connect', () => {
      socket.write(upgradeRequest(code, Number(port)));
      socket.resetAndDestroy();
    });
    sockets.push(socket);
  }
  await new Promise((done) => setTimeout(done, 300));
}

async function stillAnswers(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/tables/${UNKNOWN}`).catch(() => null);
  expect(response).not.toBeNull();
}

describe('relay upgrade refusals', () => {
  it('survives peers that reset after an upgrade for an unknown table', async () => {
    const relay = await startTestRelay();
    running.push(relay);
    await resetAfterUpgrade(relay.origin, UNKNOWN, 60);
    await stillAnswers(relay.origin);
  });

  it('survives peers that reset after being refused for too many sockets', async () => {
    const relay = await startTestRelay();
    running.push(relay);
    const created = await fetch(`${relay.origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN }, body: JSON.stringify({ code: CODE }) });
    expect(created.status).toBe(201);
    const url = `${relay.origin.replace('http', 'ws')}/api/tables/${CODE}/socket`;
    for (let i = 0; i < MAX_SOCKETS_PER_ADDRESS; i++) {
      const ws = new WebSocket(url);
      ws.on('error', () => undefined);
      held.push(ws);
      await new Promise<void>((done) => ws.once('open', () => done()));
    }
    const probe = new WebSocket(url);
    probe.on('error', () => undefined);
    const status = await new Promise<number>((done) => probe.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0)));
    expect(status).toBe(429);
    await resetAfterUpgrade(relay.origin, CODE, 60);
    await stillAnswers(relay.origin);
  });
});
