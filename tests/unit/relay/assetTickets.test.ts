import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mintTicket, readTicket } from '../../../apps/relay/src/assets/tickets.ts';
import { TICKET_URL_PATTERN } from '../../../src/app/online/protocol/fork.ts';
import { CODE, createTable } from './playerHarness.ts';
import { removeTestState, startTestRelay } from './relayHarness.ts';

const OTHER = 'b'.repeat(26);
const PLAYER = 'c'.repeat(20);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('ticketed image bytes')]);
const HASH = createHash('sha256').update(PNG).digest('hex');
const running: Array<{ close(): Promise<void> }> = [];

type Relay = Awaited<ReturnType<typeof startTestRelay>>;

async function start(log?: (line: string) => void, assetDir: string = mkdtempSync(join(tmpdir(), 'atlas-assets-'))): Promise<{ relay: Relay; assetDir: string }> {
  const relay = await startTestRelay({ assetDir }, log);
  running.push(relay);
  return { relay, assetDir };
}

async function upload(relay: Relay, code: string): Promise<string> {
  const secret = await createTable(relay.origin, code);
  const base = `${relay.origin}/api/tables/${code}/assets/${HASH}`;
  const headers = { authorization: `Bearer ${secret}` };
  expect((await fetch(`${base}/parts/0`, { method: 'PUT', headers, body: PNG })).status).toBe(200);
  expect((await fetch(`${base}/complete`, { method: 'POST', headers })).status).toBe(200);
  return secret;
}

async function mint(relay: Relay, secret: string, player: string = PLAYER, code: string = CODE, hash: string = HASH): Promise<Response> {
  return fetch(`${relay.origin}/api/tables/${code}/assets/${hash}/tickets`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ player }) });
}

async function ticketUrl(relay: Relay, secret: string, player: string = PLAYER): Promise<string> {
  const response = await mint(relay, secret, player);
  expect(response.status).toBe(200);
  return ((await response.json()) as { url: string }).url;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

async function notFound(relay: Relay, url: string): Promise<string> {
  const response = await fetch(`${relay.origin}${url}`);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.text();
  expect(body).toBe('{"error":"not-found"}');
  return body;
}

describe('ticketed downloads', () => {
  it('serves the exact bytes with the five headers to a minted ticket', async () => {
    const { relay } = await start();
    const secret = await upload(relay, CODE);
    const before = Date.now();
    const response = await mint(relay, secret);
    const { url, expires } = (await response.json()) as { url: string; expires: number };
    expect(url).toMatch(TICKET_URL_PATTERN);
    expect(url.startsWith(`/api/assets/${HASH}?t=${CODE}.${PLAYER}.`)).toBe(true);
    expect(expires).toBeGreaterThanOrEqual(before + 120_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 120_000);
    const download = await fetch(`${relay.origin}${url}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(download.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(download.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('refuses a ticket after 120 seconds', async () => {
    const { relay } = await start();
    const url = await ticketUrl(relay, await upload(relay, CODE));
    expect((await fetch(`${relay.origin}${url}`)).status).toBe(200);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    await notFound(relay, url);
  });

  it('answers every failure with the same 404', async () => {
    const { relay } = await start();
    const url = await ticketUrl(relay, await upload(relay, CODE));
    const [path = '', t = ''] = url.split('?t=');
    const parts = t.split('.');
    const mac = parts[3] ?? '';
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    const other = 'e'.repeat(20);
    const unknown = '9'.repeat(64);
    const bodies = [
      await notFound(relay, `/api/assets/${'1'.repeat(64)}?t=${t}`),
      await notFound(relay, `${path}?t=${parts.slice(0, 3).join('.')}.${flipped}`),
      await notFound(relay, `${path}?t=${parts[0]}.${other}.${parts[2]}.${mac}`),
      await notFound(relay, `/api/assets/${unknown}?t=${t}`),
      await notFound(relay, `${path}`),
      await notFound(relay, `${path}?t=garbage`),
      await notFound(relay, `/api/assets/nothex?t=${t}`),
    ];
    expect(new Set(bodies).size).toBe(1);
  });

  it('refuses a ticket signed by a relay with another state file', async () => {
    const first = await start();
    const secret = await upload(first.relay, CODE);
    const url = await ticketUrl(first.relay, secret);
    const second = await start();
    await upload(second.relay, CODE);
    await notFound(second.relay, url);
  });

  it('refuses after the table ends', async () => {
    const { relay } = await start();
    const url = await ticketUrl(relay, await upload(relay, CODE));
    relay.tables.end(CODE);
    await vi.waitFor(async () => expect((await fetch(`${relay.origin}${url}`)).status).toBe(404));
    await notFound(relay, url);
  });

  it('does not let a ticket of table A reach table B', async () => {
    const { relay } = await start();
    await createTable(relay.origin, CODE);
    await upload(relay, OTHER);
    const forged = `/api/assets/${HASH}?t=${mintTicket(relay.tables.ensureTicketKey(), CODE, PLAYER, HASH, Date.now() + 60_000)}`;
    await notFound(relay, forged);
    const own = `/api/assets/${HASH}?t=${mintTicket(relay.tables.ensureTicketKey(), OTHER, PLAYER, HASH, Date.now() + 60_000)}`;
    expect((await fetch(`${relay.origin}${own}`)).status).toBe(200);
  });

  it('logs neither the query nor the MAC', async () => {
    const lines: string[] = [];
    const { relay } = await start((line) => lines.push(line));
    const url = await ticketUrl(relay, await upload(relay, CODE));
    await fetch(`${relay.origin}${url}`);
    await vi.waitFor(() => expect(lines.some((line) => line.includes(`/api/assets/${HASH}`))).toBe(true));
    const mac = url.split('.').pop() ?? '';
    for (const line of lines) {
      expect(line).not.toContain('?t=');
      expect(line).not.toContain(mac);
    }
  });
});

describe('minting', () => {
  it('answers 404 for an unknown hash, 400 for a bad player, 401 for a wrong secret', async () => {
    const { relay } = await start();
    const secret = await upload(relay, CODE);
    expect((await mint(relay, secret, PLAYER, CODE, '7'.repeat(64))).status).toBe(404);
    expect((await mint(relay, secret, 'NOT A PLAYER')).status).toBe(400);
    expect((await mint(relay, 'x'.repeat(43))).status).toBe(401);
  });
});

describe('readTicket', () => {
  const key = Buffer.alloc(32, 7);
  it('reads a good ticket and rejects an expired one before the MAC', () => {
    const t = mintTicket(key, CODE, PLAYER, HASH, 5000);
    expect(readTicket(key, t, HASH, 4999)).toEqual({ code: CODE, player: PLAYER });
    expect(readTicket(key, t, HASH, 5000)).toBeNull();
    expect(readTicket(key, `${CODE}.${PLAYER}.5000.short`, HASH, 6000)).toBeNull();
    expect(readTicket(key, `${t}.x`, HASH, 1)).toBeNull();
    expect(readTicket(Buffer.alloc(32, 8), t, HASH, 1)).toBeNull();
  });
});
