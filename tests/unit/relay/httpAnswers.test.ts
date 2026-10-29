import { request } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { MeRateLimit } from '../../../apps/relay/src/limits.ts';
import { CODE } from './playerHarness.ts';
import { TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';
import { useTables } from './tableSuite.ts';

const suite = useTables();

function post(origin: string, code: string): Promise<Response> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN };
  return fetch(`${origin}/api/tables`, { method: 'POST', headers, body: JSON.stringify({ code }) });
}

/**
 * Streams `size` bytes chunked (no Content-Length) and resolves with the status and body. The relay may close the
 * socket right after its 413, so once a response has arrived a later reset or error is ignored. It rejects only if
 * the reset beats the response itself (the relay answers on the first oversize chunk, so that is a real failure).
 */
function chunked(origin: string, size: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let answer: { status: number; body: string } | null = null;
    const req = request(`${origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN, 'transfer-encoding': 'chunked' } }, (res) => {
      const seen = { status: res.statusCode ?? 0, body: '' };
      answer = seen;
      res.on('data', (part: Buffer) => (seen.body += part.toString()));
      res.on('end', () => resolve(seen));
      res.on('error', () => resolve(seen));
      res.on('close', () => resolve(seen));
    });
    req.on('error', (error) => (answer === null ? reject(error) : resolve(answer)));
    // 16 KiB pieces, each waiting for the previous one: the relay answers on the first piece past 4 KiB, and the client stops sending once it has read the answer.
    void (async (): Promise<void> => {
      for (let sent = 0; sent < size && answer === null && !req.destroyed; sent += 16 * 1024) {
        await new Promise<void>((next) => req.write(Buffer.alloc(Math.min(16 * 1024, size - sent), 0x20), () => next()));
        await new Promise<void>((next) => setImmediate(next));
      }
      req.end();
    })();
  });
}

describe('a re-POST whose state write fails', () => {
  it('leaves the old secret and the connected GM alone, and answers 503', async () => {
    const { relay, gm, secret } = await suite.table();
    vi.spyOn(relay.tables, 'flush').mockRejectedValueOnce(new Error('disk'));
    const response = await post(relay.origin, CODE);
    expect(response.status).toBe(503);
    expect(relay.tables.checkSecret(CODE, secret)).toBe(true);
    await gm.sync();
    expect(gm.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('leaves no table behind when it was the first POST', async () => {
    const relay = await suite.start();
    vi.spyOn(relay.tables, 'flush').mockRejectedValueOnce(new Error('disk'));
    expect((await post(relay.origin, CODE)).status).toBe(503);
    expect(relay.tables.has(CODE)).toBe(false);
    expect(relay.tables.size).toBe(0);
  });
});

describe('oversize bodies', () => {
  it('answers 413 to a chunked body over 4 KiB instead of resetting', async () => {
    const relay = await suite.start();
    expect(await chunked(relay.origin, 10 * 1024)).toEqual({ status: 413, body: '{"error":"too-large"}' });
  });

  it('answers 413 to a 1 MiB chunked body without a reset', async () => {
    const relay = await suite.start();
    expect((await chunked(relay.origin, 1024 * 1024)).status).toBe(413);
  });
});

describe('GET /api/me', () => {
  it('answers 429 rate-limited to the 61st request in a minute, and POST /api/tables still works', async () => {
    const relay = await suite.start();
    const me = (): Promise<Response> => fetch(`${relay.origin}/api/me`, { headers: { authorization: `Bearer ${TEST_HOST_KEY}` } });
    for (let i = 0; i < 60; i += 1) expect((await me()).status).toBe(200);
    const over = await me();
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'rate-limited' });
    expect((await post(relay.origin, CODE)).status).toBe(201);
  });

  it('MeRateLimit allows 60 a minute per address', () => {
    const rate = new MeRateLimit();
    for (let i = 0; i < 60; i += 1) expect(rate.allow('a', 0)).toBe(true);
    expect(rate.allow('a', 1)).toBe(false);
    expect(rate.allow('b', 1)).toBe(true);
  });
});
