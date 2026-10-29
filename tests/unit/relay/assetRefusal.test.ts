import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFUSED_DRAIN_BYTES } from '../../../apps/relay/src/httpUtil.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HASH = createHash('sha256').update('x').digest('hex');
const running: Array<{ close(): Promise<void> }> = [];

type Relay = Awaited<ReturnType<typeof startTestRelay>>;

async function start(overrides: Parameters<typeof startTestRelay>[0] = {}): Promise<{ relay: Relay; secret: string; assetDir: string }> {
  const assetDir = mkdtempSync(join(tmpdir(), 'atlas-refusal-'));
  const relay = await startTestRelay({ assetDir, ...overrides });
  running.push(relay);
  const created = await fetch(`${relay.origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN }, body: JSON.stringify({ code: CODE }) });
  return { relay, secret: ((await created.json()) as { secret: string }).secret, assetDir };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

interface Outcome {
  readonly status: number | null;
  readonly body: string;
  readonly error: string | null;
}

/** Streams `size` bytes (starting with `head`) in 16 KiB pieces as a chunked PUT of part 0. `stopOnAnswer` ends the upload once the response has arrived. */
function stream(relay: Relay, secret: string, head: Buffer, size: number, stopOnAnswer: boolean, index = 0): Promise<Outcome> {
  return new Promise((resolve) => {
    let status: number | null = null;
    let body = '';
    let settled = false;
    let responded = false;
    let sent = false;
    let failure: string | null = null;
    const finish = (error: string | null): void => {
      if (settled) return;
      if (error !== null) failure = error;
      // Done when the response has ended and the upload is over (or either failed): nothing is left writing when the relay closes.
      if (failure === null && !(responded && sent)) return;
      settled = true;
      resolve({ status, body, error: failure });
    };
    const req = request(`${relay.origin}/api/tables/${CODE}/assets/${HASH}/parts/${index}`, { method: 'PUT', headers: { authorization: `Bearer ${secret}`, 'transfer-encoding': 'chunked' } }, (res) => {
      status = res.statusCode ?? 0;
      res.on('data', (part: Buffer) => (body += part.toString()));
      res.on('end', () => {
        responded = true;
        finish(null);
      });
      res.on('error', (error) => finish(error.message));
    });
    req.on('error', (error) => finish(error.message));
    // The relay gave up and closed the socket: a write still waiting never calls back, so the close ends the upload.
    req.on('close', () => {
      sent = true;
      finish(null);
    });
    void (async (): Promise<void> => {
      for (let sent = 0; sent < size && !(stopOnAnswer && status !== null) && !req.destroyed; sent += 16 * 1024) {
        const piece = Buffer.alloc(Math.min(16 * 1024, size - sent), 0x20);
        if (sent === 0) head.copy(piece);
        await new Promise<void>((next) => req.write(piece, () => next()));
        await new Promise<void>((next) => setImmediate(next));
      }
      req.end();
      sent = true;
      finish(null);
    })();
  });
}

describe('uploads refused before their body is read', () => {
  it('answers 415 to a streamed non-image without a reset', async () => {
    const { relay, secret } = await start();
    expect(await stream(relay, secret, Buffer.from('<svg xmlns='), 4 * 1024 * 1024, true)).toEqual({ status: 415, body: '{"error":"not-an-image"}', error: null });
  });

  it('answers 507 to a streamed image over the storage cap without a reset', async () => {
    const { relay, secret } = await start({ maxTableAssetBytes: 1000 });
    expect(await stream(relay, secret, PNG_HEAD, 4 * 1024 * 1024, true)).toEqual({ status: 507, body: '{"error":"storage-full"}', error: null });
  });

  it('answers 415 even when the client keeps sending the whole body', async () => {
    const { relay, secret } = await start();
    const outcome = await stream(relay, secret, Buffer.from('<svg xmlns='), 2 * 1024 * 1024, false);
    expect(outcome).toEqual({ status: 415, body: '{"error":"not-an-image"}', error: null });
  });

  it('does not hang on a body larger than the drain bound, and keeps serving', async () => {
    const { relay, secret } = await start();
    const outcome = await stream(relay, secret, Buffer.from('<svg xmlns='), REFUSED_DRAIN_BYTES + 8 * 1024 * 1024, false);
    // The client may see the 415 or a reset once the relay gave up draining; either way it ends.
    expect(outcome.status === 415 || outcome.error !== null).toBe(true);
    expect((await fetch(`${relay.origin}/api/tables/${CODE}/assets/${HASH}`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
  }, 30_000);
});

describe('refusals made before the body is consumed', () => {
  it('answers 400 to a streamed bad part index', async () => {
    const { relay, secret } = await start();
    expect(await stream(relay, secret, PNG_HEAD, 4 * 1024 * 1024, false, 999)).toEqual({ status: 400, body: '{"error":"bad-request"}', error: null });
  });

  it('answers 401 to a streamed upload with the wrong secret', async () => {
    const { relay } = await start();
    expect(await stream(relay, 'wrong', PNG_HEAD, 4 * 1024 * 1024, true)).toEqual({ status: 401, body: '{"error":"unauthorized"}', error: null });
  });

  it('answers 200 to a streamed part of an image that is already complete', async () => {
    const { relay, secret } = await start();
    const hash = createHash('sha256').update(PNG_HEAD).digest('hex');
    const url = `${relay.origin}/api/tables/${CODE}/assets/${hash}`;
    expect((await fetch(`${url}/parts/0`, { method: 'PUT', headers: { authorization: `Bearer ${secret}` }, body: PNG_HEAD })).status).toBe(200);
    expect((await fetch(`${url}/complete`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    const again = await new Promise<Outcome>((resolve) => {
      let status: number | null = null;
      const req = request(`${url}/parts/0`, { method: 'PUT', headers: { authorization: `Bearer ${secret}`, 'transfer-encoding': 'chunked' } }, (res) => {
        status = res.statusCode ?? 0;
        res.resume();
      });
      // Done when the whole body has been sent and the answer has come, so nothing is writing when the relay closes.
      req.on('close', () => resolve({ status, body: '', error: null }));
      req.on('error', (error) => resolve({ status, body: '', error: error.message }));
      req.end(Buffer.alloc(4 * 1024 * 1024, 0x20));
    });
    expect(again).toEqual({ status: 200, body: '', error: null });
  });

  it('answers 429 to a streamed third concurrent upload', async () => {
    const { relay, secret } = await start();
    const open: Array<ReturnType<typeof request>> = [];
    for (const index of [1, 2]) {
      const req = request(`${relay.origin}/api/tables/${CODE}/assets/${HASH}/parts/${index}`, { method: 'PUT', headers: { authorization: `Bearer ${secret}`, 'content-length': '100' } });
      req.on('error', () => undefined);
      req.write(PNG_HEAD);
      open.push(req);
    }
    await vi.waitFor(() => expect(relay.assets.inFlight(CODE)).toBe(2));
    expect(await stream(relay, secret, PNG_HEAD, 4 * 1024 * 1024, false, 3)).toEqual({ status: 429, body: '{"error":"busy"}', error: null });
    for (const req of open) req.destroy();
  });
});

describe('a client that aborts an upload', () => {
  it.each([1, 3, 20])('after %i chunks of 16 KiB leaves the relay up, no partial file and no quota used', async (chunks) => {
    const { relay, secret, assetDir } = await start();
    await new Promise<void>((resolve) => {
      const req = request(`${relay.origin}/api/tables/${CODE}/assets/${HASH}/parts/0`, { method: 'PUT', headers: { authorization: `Bearer ${secret}`, 'transfer-encoding': 'chunked' } });
      req.on('error', () => undefined);
      req.on('close', () => resolve());
      // Piece by piece, each waiting for the previous one, as a real upload does; then the connection drops.
      void (async (): Promise<void> => {
        for (let i = 0; i < chunks; i += 1) {
          await new Promise<void>((next) => req.write(i === 0 ? Buffer.concat([PNG_HEAD, Buffer.alloc(16 * 1024 - PNG_HEAD.length)]) : Buffer.alloc(16 * 1024, 0x20), () => next()));
          await new Promise<void>((next) => setImmediate(next));
        }
        req.destroy();
      })();
    });
    await vi.waitFor(() => expect(relay.assets.inFlight(CODE)).toBe(0));
    expect((await fetch(`${relay.origin}/api/tables/${CODE}/assets/${HASH}`, { headers: { authorization: `Bearer ${secret}` } })).status).toBe(200);
    const files = (readdirSync(assetDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    expect(files).toEqual([]);
  });
});
