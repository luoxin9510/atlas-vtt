import { describe, expect, it, vi } from 'vitest';
import { AssetTickets, MINT_REST_MS } from '../../../../../src/app/online/gm/assetUpload/AssetTickets.ts';
import type { BinaryHttp } from '../../../../../src/app/online/gm/assetUpload/binaryHttp.ts';
import { imageCacheText } from '../../../../../src/app/online/gm/dock/imageCacheRow.ts';

const TABLE = { origin: 'https://play.example.com', code: 'a'.repeat(26), secret: 's3cret-value' };
const HASH = 'c'.repeat(64);
const BYTES = new Uint8Array(100).fill(7);
const PLAYER_A = 'a'.repeat(20);
const PLAYER_B = 'b'.repeat(20);

/** A relay whose GET answers `get` (0 = network error), and whose mint answers `mint`. */
function relay(answers: { get?: number; put?: number; mint?: number }): { http: BinaryHttp; mints: () => number } {
  let mints = 0;
  const http: BinaryHttp = async (request) => {
    if (request.url.endsWith('/tickets')) {
      mints += 1;
      const status = answers.mint ?? 200;
      return { status, json: status === 200 ? { url: `/api/assets/${HASH}?t=${TABLE.code}.${PLAYER_A}.1000000.${'M'.repeat(43)}`, expires: 999_999 } : null };
    }
    if (request.method === 'GET') return { status: answers.get ?? 200, json: answers.get === undefined || answers.get === 200 ? { parts: [] } : null };
    if (request.method === 'PUT') return { status: answers.put ?? 200, json: {} };
    return { status: 200, json: { hash: HASH } };
  };
  return { http, mints: () => mints };
}

describe('the image cache status', () => {
  it.each([
    ['put', 507, 'full'],
    ['put', 429, 'busy'],
    ['put', 413, 'refused'],
    ['put', 415, 'refused'],
    ['put', 422, 'refused'],
    ['get', 0, 'unreachable'],
    ['get', 429, 'busy'],
    ['get', 507, 'full'],
  ] as const)('a %s answered %i says %s', async (step, status, reason) => {
    const seen: unknown[] = [];
    const tickets = new AssetTickets(relay({ [step]: status }).http, TABLE, () => 1000, (cache) => seen.push(cache));
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    expect(tickets.status).toBe(reason);
    expect(seen).toEqual([reason]);
  });

  it('says nothing for a 500 or after a success, and clears after one', async () => {
    const seen: unknown[] = [];
    const tickets = new AssetTickets(relay({ put: 500 }).http, TABLE, () => 1000, (cache) => seen.push(cache));
    await tickets.ticket(HASH, BYTES, PLAYER_A);
    expect(tickets.status).toBeNull();

    let full = true;
    const flaky: BinaryHttp = (request) => (request.method === 'GET' && full ? Promise.resolve({ status: 507, json: null }) : relay({}).http(request));
    let now = 0;
    const second = new AssetTickets(flaky, TABLE, () => now, (cache) => seen.push(cache));
    await second.ticket(HASH, BYTES, PLAYER_A);
    expect(second.status).toBe('full');
    full = false;
    now = 120_000;
    expect(await second.ticket(HASH, BYTES, PLAYER_A)).not.toBeNull();
    expect(second.status).toBeNull();
    expect(seen).toEqual(['full', null]);
  });

  it.each([507, 429])('a mint answered %i is not asked again for 60 s, and is after', async (status) => {
    let now = 0;
    const fake = relay({ mint: status });
    const tickets = new AssetTickets(fake.http, TABLE, () => now);
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    expect(tickets.status).toBe(status === 507 ? 'full' : 'busy');
    expect(await tickets.ticket(HASH, BYTES, PLAYER_B)).toBeNull();
    now = MINT_REST_MS - 1;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_B)).toBeNull();
    expect(fake.mints()).toBe(1);
    now = MINT_REST_MS;
    await tickets.ticket(HASH, BYTES, PLAYER_B);
    expect(fake.mints()).toBe(2);
  });

  it('forget clears the status', async () => {
    const tickets = new AssetTickets(relay({ put: 507 }).http, TABLE, () => 0);
    await tickets.ticket(HASH, BYTES, PLAYER_A);
    tickets.forget();
    expect(tickets.status).toBeNull();
  });

  it('the line is one sentence per reason and holds no URL, hash, code or secret', () => {
    for (const reason of ['full', 'busy', 'refused', 'unreachable'] as const) {
      const text = imageCacheText(reason);
      expect(text).toContain('Image cache unavailable');
      for (const secret of [TABLE.origin, TABLE.code, TABLE.secret, HASH, 'http']) expect(text).not.toContain(secret);
    }
    expect(new Set(['full', 'busy', 'refused', 'unreachable'].map((r) => imageCacheText(r as 'full'))).size).toBe(4);
  });

  it('logs nothing', async () => {
    const spy = vi.spyOn(console, 'warn');
    const tickets = new AssetTickets(relay({ put: 507 }).http, TABLE, () => 0);
    await tickets.ticket(HASH, BYTES, PLAYER_A);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
