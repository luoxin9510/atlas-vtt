import { describe, expect, it, vi } from 'vitest';
import { ASSET_CHUNK_BYTES, ASSET_TICKET_LEVEL, type AssetTicketMessage, type GmMessage } from '../../../../src/app/online/protocol/index.ts';
import { sha256Hex } from '../../../../src/app/online/gm/assetServe.ts';
import { AssetTickets } from '../../../../src/app/online/gm/assetUpload/AssetTickets.ts';
import type { BinaryHttp } from '../../../../src/app/online/gm/assetUpload/binaryHttp.ts';
import { png } from './fakeTable.ts';
import { sceneState, shareHarness } from './shareHarness.ts';

const TABLE = { origin: 'https://play.example.com', code: 'a'.repeat(26), secret: 's3cret' };
const HASH = 'c'.repeat(64);
const BYTES = new Uint8Array(1000).map((_, index) => index % 251);
const PLAYER_A = 'a'.repeat(20);
const PLAYER_B = 'b'.repeat(20);

/** A fake relay: counts uploads (PUTs) and mints; `uploads` is how the image goes (ok or not). */
function fakeRelay(options: { upload?: boolean } = {}): { http: BinaryHttp; log: string[]; release: () => void } {
  const log: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const http: BinaryHttp = async (request) => {
    const kind = request.url.endsWith('/tickets') ? 'ticket' : request.method;
    log.push(`${kind}${request.json === undefined ? '' : ` ${JSON.stringify(request.json)}`}`);
    if (request.method === 'GET') {
      await gate;
      return { status: 200, json: { parts: [] } };
    }
    if (request.method === 'PUT') return { status: options.upload === false ? 500 : 200, json: {} };
    if (kind === 'ticket') {
      const player = (request.json as { player: string }).player;
      return { status: 200, json: { url: `/api/assets/${HASH}?t=${TABLE.code}.${player}.1000000.${'M'.repeat(43)}`, expires: 130_000 } };
    }
    return { status: 200, json: { hash: HASH } };
  };
  return { http, log, release };
}

describe('AssetTickets', () => {
  it('uploads once for two tickets asked for at the same time', async () => {
    const relay = fakeRelay();
    const tickets = new AssetTickets(relay.http, TABLE, () => 10_000);
    const both = Promise.all([tickets.ticket(HASH, BYTES, PLAYER_A), tickets.ticket(HASH, BYTES, PLAYER_B)]);
    relay.release();
    const [a, b] = await both;
    expect(a).toMatchObject({ t: 'asset-ticket', hash: HASH, expires: 130_000 });
    expect(b?.url).toContain(PLAYER_B);
    expect(relay.log.filter((line) => line === 'PUT')).toHaveLength(1);
    expect(relay.log.filter((line) => line.startsWith('ticket'))).toHaveLength(2);
  });

  it('remembers an uploaded hash: a second player is minted a ticket without a second upload', async () => {
    const relay = fakeRelay();
    relay.release();
    const tickets = new AssetTickets(relay.http, TABLE, () => 10_000);
    await tickets.ticket(HASH, BYTES, PLAYER_A);
    await tickets.ticket(HASH, BYTES, PLAYER_B);
    expect(relay.log.filter((line) => line === 'GET')).toHaveLength(1);
    expect(relay.log.filter((line) => line.startsWith('ticket'))).toHaveLength(2);
  });

  it('reuses a player\'s ticket until 10 s before it expires', async () => {
    const relay = fakeRelay();
    relay.release();
    let now = 10_000;
    const tickets = new AssetTickets(relay.http, TABLE, () => now);
    const first = await tickets.ticket(HASH, BYTES, PLAYER_A);
    now = 119_000;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBe(first);
    now = 120_001;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).not.toBe(first);
    expect(relay.log.filter((line) => line.startsWith('ticket'))).toHaveLength(2);
  });

  it('answers null for a failed upload, and again within 60 s without a request', async () => {
    const relay = fakeRelay({ upload: false });
    relay.release();
    let now = 0;
    const tickets = new AssetTickets(relay.http, TABLE, () => now);
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    const asked = relay.log.length;
    now = 59_000;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_B)).toBeNull();
    expect(relay.log.length).toBe(asked);
    now = 61_000;
    await tickets.ticket(HASH, BYTES, PLAYER_B);
    expect(relay.log.length).toBeGreaterThan(asked);
  });

  it('answers null when the relay mints no usable ticket, and forget drops what it knew', async () => {
    const relay = fakeRelay();
    relay.release();
    const bad: BinaryHttp = (request) => (request.url.endsWith('/tickets') ? Promise.resolve({ status: 404, json: null }) : relay.http(request));
    const tickets = new AssetTickets(bad, TABLE, () => 0);
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    tickets.forget();
    const again = new AssetTickets(relay.http, TABLE, () => 0);
    await again.ticket(HASH, BYTES, PLAYER_A);
    again.forget();
    await again.ticket(HASH, BYTES, PLAYER_A);
    expect(relay.log.filter((line) => line === 'GET')).toHaveLength(3);
  });
});

describe('AssetTickets against the relay\'s limits', () => {
  const hashes = ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(64));

  it('runs at most two uploads at a time and ticket all five images', async () => {
    let flying = 0;
    let most = 0;
    const done = new Set<string>();
    const http: BinaryHttp = async (request) => {
      const hash = /assets\/([0-9a-f]{64})/.exec(request.url)?.[1] ?? '';
      if (request.method === 'GET') {
        flying += 1;
        most = Math.max(most, flying);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: 200, json: { parts: [] } };
      }
      if (request.method === 'PUT') return { status: 200, json: {} };
      if (request.url.endsWith('/complete')) {
        flying -= 1;
        done.add(hash);
        return { status: 200, json: { hash } };
      }
      return { status: 200, json: { url: `/api/assets/${hash}?t=${TABLE.code}.${PLAYER_A}.1000000.${'M'.repeat(43)}`, expires: 130_000 } };
    };
    const tickets = new AssetTickets(http, TABLE, () => 0);
    const all = await Promise.all(hashes.map((hash) => tickets.ticket(hash, BYTES, PLAYER_A)));
    expect(most).toBe(2);
    expect(all.map((ticket) => ticket?.hash)).toEqual(hashes);
    expect(done.size).toBe(5);
  });

  it('does not retry a part after 429, answers null, and tries again after 10 s', async () => {
    const puts: number[] = [];
    let busy = true;
    const http: BinaryHttp = (request) => {
      if (request.method === 'GET') return Promise.resolve({ status: 200, json: { parts: [] } });
      if (request.method === 'PUT') {
        puts.push(1);
        return Promise.resolve({ status: busy ? 429 : 200, json: {} });
      }
      if (request.url.endsWith('/complete')) return Promise.resolve({ status: 200, json: { hash: HASH } });
      return Promise.resolve({ status: 200, json: { url: `/api/assets/${HASH}?t=${TABLE.code}.${PLAYER_A}.1000000.${'M'.repeat(43)}`, expires: 130_000 } });
    };
    let now = 0;
    const tickets = new AssetTickets(http, TABLE, () => now);
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    expect(puts).toHaveLength(1);
    now = 9_000;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    expect(puts).toHaveLength(1);
    busy = false;
    now = 10_001;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).not.toBeNull();
    expect(puts).toHaveLength(2);
  });

  it('uploads again on the same instance after a mint answers 404', async () => {
    const relay = fakeRelay();
    relay.release();
    let lost = true;
    const http: BinaryHttp = (request) => (lost && request.url.endsWith('/tickets') ? Promise.resolve({ status: 404, json: null }) : relay.http(request));
    const tickets = new AssetTickets(http, TABLE, () => 0);
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).toBeNull();
    lost = false;
    expect(await tickets.ticket(HASH, BYTES, PLAYER_A)).not.toBeNull();
    expect(relay.log.filter((line) => line === 'GET')).toHaveLength(2);
  });
});

describe('asset answers with tickets', () => {
  const MAP = new Uint8Array(ASSET_CHUNK_BYTES * 2 + 5).map((_, index) => index % 251);
  const SCALED = new Uint8Array(5000).map((_, index) => (index * 7) % 253);

  function table(tickets: (hash: string, player: string) => Promise<AssetTicketMessage | null>): ReturnType<typeof shareHarness> & { asked: string[] } {
    const asked: string[] = [];
    const harness = shareHarness(sceneState(), new Map([['maps/cave.webp', MAP]]), undefined, undefined, {
      tickets: { ticket: (hash, _bytes, player) => (asked.push(`${hash}>${player}`), tickets(hash, player)) },
      scaleImage: () => Promise.resolve({ bytes: SCALED, mime: 'image/webp', width: 100, height: 50 }),
    });
    return Object.assign(harness, { asked });
  }
  const ticketFor = (hash: string): AssetTicketMessage => ({ t: 'asset-ticket', hash, url: `/api/assets/${hash}?t=x`, expires: 1 });
  const kinds = (sent: readonly { body: GmMessage }[]): string[] => sent.map(({ body }) => body.t).filter((t) => t.startsWith('asset-'));

  it('sends a level 2 player the variant announcement, then a ticket for the variant\'s hash and no chunks', async () => {
    const mine = table((hash) => Promise.resolve(ticketFor(hash)));
    mine.forkLevels = new Map([['alice', ASSET_TICKET_LEVEL]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    const hash = await sha256Hex(MAP);
    mine.share.receive('alice', { t: 'asset-request', hash, maxSide: 1024 });
    const variant = await sha256Hex(SCALED);
    await vi.waitFor(() => expect(kinds(mine.sent)).toEqual(['asset-variant', 'asset-ticket']));
    expect(mine.asked).toEqual([`${variant}>alice`]);
    expect(mine.sent[1]).toEqual({ body: ticketFor(variant), to: 'alice' });
  });

  it('tickets the original for a request without maxSide', async () => {
    const mine = table((hash) => Promise.resolve(ticketFor(hash)));
    mine.forkLevels = new Map([['alice', 2]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    const hash = await sha256Hex(MAP);
    mine.share.receive('alice', { t: 'asset-request', hash });
    await vi.waitFor(() => expect(kinds(mine.sent)).toEqual(['asset-ticket']));
    expect(mine.asked).toEqual([`${hash}>alice`]);
  });

  it.each([['an image that needs no scaling', true], ['a table that cannot scale', false]])('tickets the original for a request with maxSide when the image fits: %s', async (_name, hasScaler) => {
    const small = png(100, 100);
    const asked: string[] = [];
    const mine = shareHarness(sceneState(), new Map([['maps/cave.webp', small]]), undefined, undefined, {
      tickets: { ticket: (hash, _bytes, player) => (asked.push(`${hash}>${player}`), Promise.resolve(ticketFor(hash))) },
      ...(hasScaler ? { scaleImage: () => Promise.resolve(null) } : {}),
    });
    mine.forkLevels = new Map([['alice', ASSET_TICKET_LEVEL]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    const hash = await sha256Hex(small);
    mine.share.receive('alice', { t: 'asset-request', hash, maxSide: 8192 });
    await vi.waitFor(() => expect(kinds(mine.sent)).toEqual(['asset-ticket']));
    expect(asked).toEqual([`${hash}>alice`]);
  });

  it.each([['a scaler that fails', true], ['a table that cannot scale', false]])('sends chunks, not a ticket, for an image larger than maxSide: %s', async (_name, hasScaler) => {
    const large = png(5000, 5000);
    const asked: string[] = [];
    const mine = shareHarness(sceneState(), new Map([['maps/cave.webp', large]]), undefined, undefined, {
      tickets: { ticket: (hash, _bytes, player) => (asked.push(`${hash}>${player}`), Promise.resolve(ticketFor(hash))) },
      ...(hasScaler ? { scaleImage: () => Promise.reject(new Error('no decoder')) } : {}),
    });
    mine.forkLevels = new Map([['alice', ASSET_TICKET_LEVEL]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    mine.share.receive('alice', { t: 'asset-request', hash: await sha256Hex(large), maxSide: 1024 });
    await mine.advance(0);
    await vi.waitFor(() => expect(kinds(mine.sent).length).toBeGreaterThan(0));
    expect(new Set(kinds(mine.sent))).toEqual(new Set(['asset-chunk']));
    expect(asked).toEqual([]);
  });

  it('sends chunks to a level 1 player and never asks for a ticket', async () => {
    const mine = table((hash) => Promise.resolve(ticketFor(hash)));
    mine.forkLevels = new Map([['alice', 1]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    mine.share.receive('alice', { t: 'asset-request', hash: await sha256Hex(MAP) });
    await mine.advance(0);
    expect(kinds(mine.sent)).toEqual(['asset-chunk', 'asset-chunk', 'asset-chunk']);
    expect(mine.asked).toEqual([]);
  });

  it('sends chunks for via socket within 10 s of the ticketed request, not throttled', async () => {
    const mine = table((hash) => Promise.resolve(ticketFor(hash)));
    mine.forkLevels = new Map([['alice', 2]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    const hash = await sha256Hex(MAP);
    mine.share.receive('alice', { t: 'asset-request', hash });
    await mine.advance(2000);
    mine.sent.length = 0;
    mine.share.receive('alice', { t: 'asset-request', hash, via: 'socket' });
    await mine.advance(0);
    expect(kinds(mine.sent)).toEqual(['asset-chunk', 'asset-chunk', 'asset-chunk']);
  });

  it('serves chunks when the tickets answer null', async () => {
    const mine = table(() => Promise.resolve(null));
    mine.forkLevels = new Map([['alice', 2]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    mine.share.receive('alice', { t: 'asset-request', hash: await sha256Hex(MAP) });
    await mine.advance(0);
    expect(kinds(mine.sent)).toEqual(['asset-chunk', 'asset-chunk', 'asset-chunk']);
  });

  it('refuses an asset outside the picture and never calls the tickets', async () => {
    const mine = table((hash) => Promise.resolve(ticketFor(hash)));
    mine.forkLevels = new Map([['alice', 2]]);
    mine.share.start();
    await mine.set(sceneState());
    mine.sent.length = 0;
    mine.share.receive('alice', { t: 'asset-request', hash: 'f'.repeat(64) });
    await mine.advance(0);
    expect(mine.sent).toEqual([{ body: { t: 'asset-refused', hash: 'f'.repeat(64) }, to: 'alice' }]);
    expect(mine.asked).toEqual([]);
  });
});
