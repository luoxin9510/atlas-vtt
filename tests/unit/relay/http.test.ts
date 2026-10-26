import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../apps/relay/src/config.ts';
import { clientAddress } from '../../../apps/relay/src/limits.ts';
import { TableRegistry } from '../../../apps/relay/src/tables.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const running: Array<{ close(): Promise<void> }> = [];

async function start(...args: Parameters<typeof startTestRelay>): ReturnType<typeof startTestRelay> {
  const relay = await startTestRelay(...args);
  running.push(relay);
  return relay;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
});

interface PostOptions {
  readonly bearer?: string;
  readonly origin?: string | null;
}

function postTable(origin: string, code: string, options: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${options.bearer ?? TEST_HOST_KEY}` };
  if (options.origin !== null) headers.origin = options.origin ?? TEST_PUBLIC_ORIGIN;
  return fetch(`${origin}/api/tables`, { method: 'POST', headers, body: JSON.stringify({ code, gmLevel: 7 }) });
}

function codeNumber(n: number): string {
  return `${'a'.repeat(25)}${'bcdefghijklmnopqrstuvwxyz234567'[n]}`;
}

describe('POST /api/tables', () => {
  it('creates a table and answers 201 with the echoed code, a secret and maxPlayers', async () => {
    const relay = await start();
    const response = await postTable(relay.origin, CODE);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; secret: string; maxPlayers: number };
    expect(body.code).toBe(CODE);
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.maxPlayers).toBe(8);
    expect(relay.tables.checkSecret(CODE, body.secret)).toBe(true);
  });

  it('allows a request without an Origin header (Obsidian sends none)', async () => {
    const relay = await start();
    expect((await postTable(relay.origin, CODE, { origin: null })).status).toBe(201);
  });

  it('answers 401 for a wrong bearer', async () => {
    const relay = await start();
    expect((await postTable(relay.origin, CODE, { bearer: 'not-the-host-key-at-all-1234' })).status).toBe(401);
  });

  it('locks the client after 5 wrong bearers: the right one then answers 429', async () => {
    const relay = await start();
    for (let i = 0; i < 5; i += 1) expect((await postTable(relay.origin, CODE, { bearer: 'wrong-host-key-wrong-host-key' })).status).toBe(401);
    expect((await postTable(relay.origin, CODE)).status).toBe(429);
  });

  it('answers 429 for the 11th table', async () => {
    const relay = await start();
    for (let i = 0; i < 10; i += 1) expect((await postTable(relay.origin, codeNumber(i))).status).toBe(201);
    expect((await postTable(relay.origin, codeNumber(10))).status).toBe(429);
  });

  it('answers 429 for the 11th request within a minute even for one table', async () => {
    const relay = await start();
    for (let i = 0; i < 10; i += 1) expect((await postTable(relay.origin, CODE)).status).toBe(201);
    expect((await postTable(relay.origin, CODE)).status).toBe(429);
  });

  it('answers 400 for a code that is not 26 base32 characters', async () => {
    const relay = await start();
    expect((await postTable(relay.origin, 'A'.repeat(26))).status).toBe(400);
    expect((await postTable(relay.origin, 'a'.repeat(25))).status).toBe(400);
    expect((await postTable(relay.origin, 'a'.repeat(25) + '1')).status).toBe(400);
  });

  it('answers 403 for a foreign Origin', async () => {
    const relay = await start();
    expect((await postTable(relay.origin, CODE, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('gives a re-POST of the same code a new secret and drops the old one', async () => {
    const relay = await start();
    const first = (await (await postTable(relay.origin, CODE)).json()) as { secret: string };
    const second = (await (await postTable(relay.origin, CODE)).json()) as { secret: string };
    expect(second.secret).not.toBe(first.secret);
    expect(relay.tables.checkSecret(CODE, first.secret)).toBe(false);
    expect(relay.tables.checkSecret(CODE, second.secret)).toBe(true);
  });

  it('stores only a hash of the secret, and a restarted relay still accepts it', async () => {
    const first = await start();
    const { secret } = (await (await postTable(first.origin, CODE)).json()) as { secret: string };
    const stored = readFileSync(first.config.statePath, 'utf8');
    expect(stored).not.toContain(secret);
    expect(stored).toMatch(/[0-9a-f]{64}/);
    await first.close();
    const restarted = await start({ statePath: first.config.statePath });
    expect(restarted.tables.checkSecret(CODE, secret)).toBe(true);
    expect(restarted.tables.checkSecret(CODE, 'x'.repeat(43))).toBe(false);
  });

  it('deletes a table nobody hosted after unhostedTableMs', async () => {
    const relay = await start({ timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 50 } });
    const { secret } = (await (await postTable(relay.origin, CODE)).json()) as { secret: string };
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(relay.tables.checkSecret(CODE, secret)).toBe(false);
  });
});

describe('other routes', () => {
  it('answers GET /api/me with the host account and maxPlayers', async () => {
    const relay = await start({ maxPlayers: 5 });
    const response = await fetch(`${relay.origin}/api/me`, { headers: { authorization: `Bearer ${TEST_HOST_KEY}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: { id: 'host', handle: 'host', name: 'Host' }, access: { plan: 'host', maxPlayers: 5 } });
  });

  it('answers GET /api/me with 401 for a wrong bearer', async () => {
    const relay = await start();
    expect((await fetch(`${relay.origin}/api/me`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('locks GET /api/me after 5 wrong bearers: the right one then answers 429', async () => {
    const relay = await start();
    const me = (bearer: string): Promise<Response> => fetch(`${relay.origin}/api/me`, { headers: { authorization: `Bearer ${bearer}` } });
    for (let i = 0; i < 5; i += 1) expect((await me('wrong-host-key-wrong-host-key')).status).toBe(401);
    expect((await me(TEST_HOST_KEY)).status).toBe(429);
  });

  it('shares the lock between endpoints: wrong keys on /api/me lock POST /api/tables and back', async () => {
    const relay = await start();
    for (let i = 0; i < 5; i += 1) await fetch(`${relay.origin}/api/me`, { headers: { authorization: 'Bearer wrong-host-key-wrong-host-key' } });
    expect((await postTable(relay.origin, CODE)).status).toBe(429);
    const other = await start();
    for (let i = 0; i < 3; i += 1) await postTable(other.origin, CODE, { bearer: 'wrong-host-key-wrong-host-key' });
    for (let i = 0; i < 2; i += 1) await fetch(`${other.origin}/api/me`, { headers: { authorization: 'Bearer wrong-host-key-wrong-host-key' } });
    expect((await fetch(`${other.origin}/api/me`, { headers: { authorization: `Bearer ${TEST_HOST_KEY}` } })).status).toBe(429);
  });

  it('answers POST /api/feedback with 204', async () => {
    const relay = await start();
    expect((await fetch(`${relay.origin}/api/feedback`, { method: 'POST', body: '{}' })).status).toBe(204);
  });

  it('answers 404 for an unknown route', async () => {
    const relay = await start();
    expect((await fetch(`${relay.origin}/nope`)).status).toBe(404);
  });
});

describe('TableRegistry', () => {
  it('refuses an 11th table but lets an existing code be replaced', async () => {
    const relay = await start();
    const registry = new TableRegistry({ statePath: `${relay.config.statePath}.other`, maxPlayers: 8, unhostedTableMs: 60_000 });
    for (let i = 0; i < 10; i += 1) expect(registry.create(codeNumber(i))).not.toBe('full');
    expect(registry.create(codeNumber(10))).toBe('full');
    expect(registry.create(codeNumber(3))).not.toBe('full');
    registry.end(codeNumber(3));
    expect(registry.create(codeNumber(10))).not.toBe('full');
    await registry.close();
  });
});

describe('config and client address', () => {
  const env = { HOST_KEY: 'k'.repeat(24), PUBLIC_ORIGIN: 'HTTPS://Play.Example.test:443' };

  it('loads defaults and normalises the public origin', () => {
    const config = loadConfig(env);
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8787, publicOrigin: 'https://play.example.test', maxPlayers: 8, statePath: './relay-state.json', staticDir: null, trustProxy: 'none' });
    expect(config.timing).toEqual({ knockWaitMs: 180_000, wrongCodeWindowMs: 600_000, wrongCodePauseMs: 600_000, unhostedTableMs: 1_209_600_000 });
  });

  it('rejects a short host key, a missing or path-bearing origin and a bad MAX_PLAYERS', () => {
    expect(() => loadConfig({ ...env, HOST_KEY: 'short' })).toThrow(/HOST_KEY/);
    expect(() => loadConfig({ HOST_KEY: env.HOST_KEY })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => loadConfig({ ...env, PUBLIC_ORIGIN: 'https://x.test/path' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => loadConfig({ ...env, MAX_PLAYERS: '13' })).toThrow(/MAX_PLAYERS/);
    expect(() => loadConfig({ ...env, TRUST_PROXY: 'bogus' })).toThrow(/TRUST_PROXY/);
  });

  it('reads the client address from the peer unless a proxy is trusted', () => {
    const request = { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'cf-connecting-ip': '9.9.9.9' } } as never;
    expect(clientAddress(request, 'none')).toBe('10.0.0.1');
    expect(clientAddress(request, 'xff')).toBe('5.6.7.8');
    expect(clientAddress(request, 'cf')).toBe('9.9.9.9');
  });
});
