import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetStore } from '../../../apps/relay/src/assets/assetStore.ts';
import { sniffImage } from '../../../apps/relay/src/assets/sniff.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const PART = 8 * 1024 * 1024;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const running: Array<{ close(): Promise<void> }> = [];
const folders: string[] = [];

type Relay = Awaited<ReturnType<typeof startTestRelay>>;

async function start(overrides: Parameters<typeof startTestRelay>[0] = {}, log?: (line: string) => void): Promise<{ relay: Relay; secret: string; assetDir: string }> {
  const assetDir = mkdtempSync(join(tmpdir(), 'atlas-assets-'));
  folders.push(assetDir);
  const relay = await startTestRelay({ assetDir, ...overrides }, log);
  running.push(relay);
  const created = await fetch(`${relay.origin}/api/tables`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN },
    body: JSON.stringify({ code: CODE }),
  });
  const { secret } = (await created.json()) as { secret: string };
  return { relay, secret, assetDir };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

function pngParts(count: number, lastSize = PART): Buffer[] {
  return Array.from({ length: count }, (_, i) => {
    const part = Buffer.alloc(i === count - 1 ? lastSize : PART, i + 1);
    if (i === 0) PNG_HEAD.copy(part);
    return part;
  });
}

const hashOf = (parts: Buffer[]): string => createHash('sha256').update(Buffer.concat(parts)).digest('hex');
const base = (relay: Relay, hash: string): string => `${relay.origin}/api/tables/${CODE}/assets/${hash}`;
const auth = (secret: string): Record<string, string> => ({ authorization: `Bearer ${secret}` });

function put(relay: Relay, secret: string, hash: string, index: number, body: Buffer): Promise<Response> {
  return fetch(`${base(relay, hash)}/parts/${index}`, { method: 'PUT', headers: auth(secret), body });
}
const complete = (relay: Relay, secret: string, hash: string): Promise<Response> => fetch(`${base(relay, hash)}/complete`, { method: 'POST', headers: auth(secret) });
const status = (relay: Relay, secret: string, hash: string): Promise<Response> => fetch(base(relay, hash), { headers: auth(secret) });

describe('sniffImage', () => {
  it('knows the five types by magic bytes and nothing else', () => {
    const riff = (kind: string): Uint8Array => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from(kind)]);
    const ftyp = (brand: string): Uint8Array => Buffer.concat([Buffer.alloc(4), Buffer.from(`ftyp${brand}`)]);
    expect(sniffImage(PNG_HEAD)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF87a'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffImage(riff('WEBP'))).toBe('image/webp');
    expect(sniffImage(riff('WAVE'))).toBeNull();
    expect(sniffImage(ftyp('avif'))).toBe('image/avif');
    expect(sniffImage(ftyp('avis'))).toBe('image/avif');
    expect(sniffImage(ftyp('mp42'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns='))).toBeNull();
    expect(sniffImage(Buffer.from('<!doctype html>'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('uploading an image', () => {
  it('takes a three part PNG, completes it, and completes again at once', async () => {
    const { relay, secret, assetDir } = await start();
    const parts = pngParts(3, 1000);
    const hash = hashOf(parts);
    for (const [index, part] of parts.entries()) expect((await put(relay, secret, hash, index, part)).status).toBe(200);
    const done = await complete(relay, secret, hash);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ hash });
    expect(relay.assets.has(CODE, hash)).toBe(true);
    expect(readFileSync(join(assetDir, CODE, hash)).length).toBe(2 * PART + 1000);
    expect(existsSync(join(assetDir, CODE, '.parts', hash))).toBe(false);
    const again = await complete(relay, secret, hash);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ hash });
    expect(await (await status(relay, secret, hash)).json()).toEqual({ complete: true });
  }, 30_000);

  it('lists the parts held so a broken upload resumes', async () => {
    const { relay, secret } = await start();
    const parts = pngParts(3, 10);
    const hash = hashOf(parts);
    expect(await (await status(relay, secret, hash)).json()).toEqual({ parts: [] });
    await put(relay, secret, hash, 0, parts[0] as Buffer);
    await put(relay, secret, hash, 2, parts[2] as Buffer);
    expect(await (await status(relay, secret, hash)).json()).toEqual({ parts: [0, 2] });
    expect((await complete(relay, secret, hash)).status).toBe(409);
    expect((await put(relay, secret, hash, 1, parts[1] as Buffer)).status).toBe(200);
    expect((await complete(relay, secret, hash)).status).toBe(200);
  }, 30_000);

  it('refuses a part over 8 MiB with 413 and keeps nothing of it', async () => {
    const { relay, secret, assetDir } = await start();
    const hash = 'b'.repeat(64);
    const big = Buffer.alloc(PART + 1);
    PNG_HEAD.copy(big);
    expect((await put(relay, secret, hash, 0, big)).status).toBe(413);
    expect(await (await status(relay, secret, hash)).json()).toEqual({ parts: [] });
    expect(existsSync(join(assetDir, CODE, '.parts', hash))).toBe(false);
  });

  it('takes eight full parts (64 MiB, the most) and no part nine', async () => {
    const { relay, secret } = await start();
    const hash = 'c'.repeat(64);
    for (const [index, part] of pngParts(8).entries()) expect((await put(relay, secret, hash, index, part)).status).toBe(200);
    expect((await put(relay, secret, hash, 8, Buffer.alloc(1))).status).toBe(400);
    expect((await complete(relay, secret, hash)).status).toBe(422);
  }, 60_000);

  it('refuses part 0 that is not one of the five image types with 415', async () => {
    const { relay, secret } = await start();
    expect((await put(relay, secret, 'd'.repeat(64), 0, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).status).toBe(415);
    expect((await put(relay, secret, 'e'.repeat(64), 0, Buffer.from('<!doctype html><title>x</title>'))).status).toBe(415);
    expect((await put(relay, secret, 'f'.repeat(64), 0, Buffer.from([1, 2]))).status).toBe(415);
  });

  it('answers 422 for a wrong final hash and drops the parts', async () => {
    const { relay, secret } = await start();
    const parts = pngParts(2, 100);
    const wrong = '0'.repeat(64);
    await put(relay, secret, wrong, 0, parts[0] as Buffer);
    await put(relay, secret, wrong, 1, parts[1] as Buffer);
    expect((await complete(relay, secret, wrong)).status).toBe(422);
    expect(await (await status(relay, secret, wrong)).json()).toEqual({ parts: [] });
    expect(relay.assets.has(CODE, wrong)).toBe(false);
  }, 30_000);

  it('answers 401 with one body for a wrong or missing secret on every route', async () => {
    const { relay, secret } = await start();
    const hash = 'a1'.repeat(32);
    const bad = auth('x'.repeat(43));
    const answers = await Promise.all([
      fetch(`${base(relay, hash)}/parts/0`, { method: 'PUT', headers: bad, body: PNG_HEAD }),
      fetch(`${base(relay, hash)}/complete`, { method: 'POST', headers: bad }),
      fetch(base(relay, hash), { headers: bad }),
      fetch(base(relay, hash)),
    ]);
    expect(answers.map((a) => a.status)).toEqual([401, 401, 401, 401]);
    expect(new Set(await Promise.all(answers.map((a) => a.text()))).size).toBe(1);
    expect((await status(relay, secret, hash)).status).toBe(200);
  });

  it('answers 429 on the 61st upload-route request in a minute', async () => {
    const { relay, secret } = await start();
    const hash = 'a2'.repeat(32);
    for (let i = 0; i < 60; i += 1) expect((await status(relay, secret, hash)).status).toBe(200);
    expect((await status(relay, secret, hash)).status).toBe(429);
  });

  it('answers 429 for a third concurrent upload', async () => {
    const { relay, secret } = await start();
    const open: Array<ReturnType<typeof request>> = [];
    for (const index of [1, 2]) {
      const req = request(`${base(relay, 'a3'.repeat(32))}/parts/${index}`, { method: 'PUT', headers: { ...auth(secret), 'content-length': '100' } });
      req.on('error', () => undefined);
      req.write(PNG_HEAD);
      open.push(req);
    }
    await vi.waitFor(async () => expect(relay.assets.inFlight(CODE)).toBe(2));
    expect((await put(relay, secret, 'a3'.repeat(32), 3, Buffer.from('xx'))).status).toBe(429);
    for (const req of open) req.destroy();
    await vi.waitFor(() => expect(relay.assets.inFlight(CODE)).toBe(0));
    expect((await put(relay, secret, 'a3'.repeat(32), 3, Buffer.from('xx'))).status).toBe(200);
  });

  it('answers 429 for a fifth unfinished image', async () => {
    const { relay, secret } = await start();
    for (let i = 0; i < 4; i += 1) expect((await put(relay, secret, String(i).repeat(64), 0, PNG_HEAD)).status).toBe(200);
    expect((await put(relay, secret, '9'.repeat(64), 0, PNG_HEAD)).status).toBe(429);
    expect((await put(relay, secret, '0'.repeat(64), 1, PNG_HEAD)).status).toBe(200);
  });

  it('answers 507 over the table cap and the server cap', async () => {
    const table = await start({ maxTableAssetBytes: 100 });
    expect((await put(table.relay, table.secret, 'a4'.repeat(32), 0, Buffer.concat([PNG_HEAD, Buffer.alloc(50)]))).status).toBe(200);
    expect((await put(table.relay, table.secret, 'a5'.repeat(32), 0, Buffer.concat([PNG_HEAD, Buffer.alloc(50)]))).status).toBe(507);
    const server = await start({ maxServerAssetBytes: 100 });
    expect((await put(server.relay, server.secret, 'a6'.repeat(32), 0, Buffer.concat([PNG_HEAD, Buffer.alloc(200)]))).status).toBe(507);
  });

  it('answers 507 when the disk has less free space than minFreeBytes', async () => {
    const { relay, secret } = await start({ minFreeBytes: 2 ** 60 });
    expect((await put(relay, secret, 'a7'.repeat(32), 0, PNG_HEAD)).status).toBe(507);
  });

  it('logs the path only, never the secret or a query', async () => {
    const lines: string[] = [];
    const { relay, secret } = await start({}, (line) => lines.push(line));
    await fetch(`${base(relay, 'a8'.repeat(32))}?t=sekrit-ticket`, { headers: auth(secret) });
    await put(relay, secret, 'a8'.repeat(32), 0, PNG_HEAD);
    expect(lines.some((line) => line.includes('/assets/'))).toBe(true);
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('sekrit');
    expect(lines.join('\n')).not.toContain('?');
  });
});

describe('keeping and cleaning', () => {
  it('keeps the ticket key across saves', async () => {
    const { relay } = await start();
    const key = relay.tables.ensureTicketKey();
    expect(key.length).toBe(32);
    relay.tables.create('b'.repeat(26));
    await relay.tables.flush();
    const saved = JSON.parse(readFileSync(relay.config.statePath, 'utf8')) as { ticketKey: string; tables: Record<string, unknown> };
    expect(Buffer.from(saved.ticketKey, 'base64url').equals(key)).toBe(true);
    expect(Object.keys(saved.tables)).toHaveLength(2);
    expect(relay.tables.ensureTicketKey().equals(key)).toBe(true);
  });

  it('deletes images when a table ends', async () => {
    const { relay, secret, assetDir } = await start();
    const parts = pngParts(1, 100);
    const hash = hashOf(parts);
    await put(relay, secret, hash, 0, parts[0] as Buffer);
    await complete(relay, secret, hash);
    expect(existsSync(join(assetDir, CODE, hash))).toBe(true);
    relay.tables.end(CODE);
    await vi.waitFor(() => expect(existsSync(join(assetDir, CODE))).toBe(false));
    expect(relay.assets.has(CODE, hash)).toBe(false);
  });

  it('keeps images across a restart and sweeps parts older than an hour', async () => {
    let now = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'atlas-store-'));
    folders.push(dir);
    const limits = { maxTableBytes: 2 ** 30, maxServerBytes: 2 ** 30, minFreeBytes: 0 };
    const store = await AssetStore.open(dir, limits, () => now);
    const { Readable } = await import('node:stream');
    const hash = 'ab'.repeat(32);
    expect((await store.writePart(CODE, hash, 0, Readable.from([PNG_HEAD]))).status).toBe(200);
    const reopened = await AssetStore.open(dir, limits, () => now);
    expect(reopened.status(CODE, hash)).toEqual({ parts: [0] });
    now += 59 * 60_000;
    await reopened.sweep();
    expect(reopened.status(CODE, hash)).toEqual({ parts: [0] });
    now += 2 * 60_000;
    await reopened.sweep();
    expect(reopened.status(CODE, hash)).toEqual({ parts: [] });
    expect(existsSync(join(dir, CODE, '.parts', hash))).toBe(false);
  });
});
