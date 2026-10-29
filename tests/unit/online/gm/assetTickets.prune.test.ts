import { describe, expect, it } from 'vitest';
import { ASSET_TICKET_CAP, AssetTickets } from '../../../../src/app/online/gm/assetUpload/AssetTickets.ts';
import type { BinaryHttp } from '../../../../src/app/online/gm/assetUpload/binaryHttp.ts';

const TABLE = { origin: 'https://play.example.com', code: 'a'.repeat(26), secret: 's3cret' };
const BYTES = new Uint8Array(100);
const PLAYER = 'a'.repeat(20);
const hashOf = (index: number): string => index.toString(16).padStart(64, '0');
const HASHES = Array.from({ length: ASSET_TICKET_CAP + 1 }, (_, index) => hashOf(index));

interface Relay {
  http: BinaryHttp;
  /** How many requests named each hash. */
  seen: Map<string, number>;
}

/** A relay that uploads and mints for any hash, except that `badUpload` hashes fail to upload and `busyMint` hashes are answered 429 on mint. */
function relay(options: { badUpload?: boolean; busyMint?: boolean } = {}): Relay {
  const seen = new Map<string, number>();
  const http: BinaryHttp = async (request) => {
    const hash = /assets\/([0-9a-f]{64})/.exec(request.url)?.[1] ?? '';
    seen.set(hash, (seen.get(hash) ?? 0) + 1);
    if (request.method === 'GET') return { status: 200, json: { parts: [] } };
    if (request.method === 'PUT') return { status: options.badUpload === true ? 500 : 200, json: {} };
    if (request.url.endsWith('/complete')) return { status: 200, json: { hash } };
    if (options.busyMint === true) return { status: 429, json: {} };
    return { status: 200, json: { url: `/api/assets/${hash}?t=${TABLE.code}.${PLAYER}.1000000.${'M'.repeat(43)}`, expires: 130_000 } };
  };
  return { http, seen };
}

interface Inside {
  minted: Map<string, unknown>;
  failed: Map<string, number>;
  mintRests: Map<string, number>;
}
const inside = (tickets: AssetTickets): Inside => tickets as unknown as Inside;

describe('AssetTickets pruning', () => {
  it('drops the oldest minted ticket past the cap, and mints that hash again instead of refusing it', async () => {
    const { http, seen } = relay();
    const tickets = new AssetTickets(http, TABLE, () => 0);
    const first = await tickets.ticket(HASHES[0]!, BYTES, PLAYER);
    expect(await tickets.ticket(HASHES[0]!, BYTES, PLAYER)).toBe(first);
    for (const hash of HASHES.slice(1)) await tickets.ticket(hash, BYTES, PLAYER);
    expect(inside(tickets).minted.size).toBe(ASSET_TICKET_CAP);
    const again = await tickets.ticket(HASHES[0]!, BYTES, PLAYER);
    expect(again).not.toBeNull();
    expect(again).not.toBe(first);
    expect(seen.get(HASHES[0]!)).toBeGreaterThan(3);
    // The newest ticket is still kept.
    const newest = HASHES[ASSET_TICKET_CAP]!;
    const before = seen.get(newest);
    await tickets.ticket(newest, BYTES, PLAYER);
    expect(seen.get(newest)).toBe(before);
  });

  it('drops the oldest failed hash past the cap, so it is tried again at once', async () => {
    const { http, seen } = relay({ badUpload: true });
    const tickets = new AssetTickets(http, TABLE, () => 0);
    for (const hash of HASHES) expect(await tickets.ticket(hash, BYTES, PLAYER)).toBeNull();
    expect(inside(tickets).failed.size).toBe(ASSET_TICKET_CAP);
    const before = seen.get(HASHES[0]!) ?? 0;
    await tickets.ticket(HASHES[0]!, BYTES, PLAYER);
    expect(seen.get(HASHES[0]!)).toBeGreaterThan(before);
    const newest = seen.get(HASHES[ASSET_TICKET_CAP]!);
    await tickets.ticket(HASHES[ASSET_TICKET_CAP]!, BYTES, PLAYER);
    expect(seen.get(HASHES[ASSET_TICKET_CAP]!)).toBe(newest);
  });

  it('never prunes a rest that is still running, so the cap is soft for active rests', async () => {
    const { http, seen } = relay({ busyMint: true });
    const tickets = new AssetTickets(http, TABLE, () => 0);
    for (const hash of HASHES) expect(await tickets.ticket(hash, BYTES, PLAYER)).toBeNull();
    expect(inside(tickets).mintRests.size).toBe(ASSET_TICKET_CAP + 1);
    const before = seen.get(HASHES[0]!);
    expect(await tickets.ticket(HASHES[0]!, BYTES, PLAYER)).toBeNull();
    expect(seen.get(HASHES[0]!)).toBe(before);
  });

  it('drops finished rests, oldest first, once the cap is passed', async () => {
    const { http } = relay({ busyMint: true });
    let now = 0;
    const tickets = new AssetTickets(http, TABLE, () => now);
    for (const hash of HASHES.slice(0, 100)) await tickets.ticket(hash, BYTES, PLAYER);
    now = 61_000;
    for (const hash of HASHES.slice(100)) await tickets.ticket(hash, BYTES, PLAYER);
    expect(inside(tickets).mintRests.size).toBe(ASSET_TICKET_CAP);
    expect(inside(tickets).mintRests.has(HASHES[0]!)).toBe(false);
    expect(inside(tickets).mintRests.has(HASHES[ASSET_TICKET_CAP]!)).toBe(true);
  });
});
