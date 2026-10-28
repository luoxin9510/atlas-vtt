import { describe, expect, it } from 'vitest';
import { FORK_APP, FORK_PROTOCOL_LEVEL, PAUSE_LEVEL, TICKET_URL_PATTERN, parseGmMessage, parsePlayerMessage } from '../../../../src/app/online/protocol/index.ts';

describe('the fork protocol messages', () => {
  it('keeps the fork level apart from upstream\'s', () => {
    expect(FORK_PROTOCOL_LEVEL).toBe(2);
    expect(FORK_APP).toBe('atlas-fork-play');
  });

  it('reads a client message with a whole level from 0 to 1000 and an app name of at most 64 characters', () => {
    expect(parsePlayerMessage({ t: 'client', app: 'atlas-fork-play', forkLevel: 1 })).toEqual({ t: 'client', app: 'atlas-fork-play', forkLevel: 1 });
    expect(parsePlayerMessage({ t: 'client', app: 'x'.repeat(64), forkLevel: 0 })).not.toBeNull();
    expect(parsePlayerMessage({ t: 'client', app: 'x'.repeat(65), forkLevel: 1 })).toBeNull();
    for (const forkLevel of [1.5, -1, 1001, '1', null, Number.NaN]) expect(parsePlayerMessage({ t: 'client', app: 'a', forkLevel })).toBeNull();
    expect(parsePlayerMessage({ t: 'client', forkLevel: 1 })).toBeNull();
    expect(parsePlayerMessage({ t: 'client', app: 'a' })).toBeNull();
  });

  it('reads your-turn with a scene, and nothing without one', () => {
    expect(parseGmMessage({ t: 'your-turn', scene: 's1' })).toEqual({ t: 'your-turn', scene: 's1' });
    expect(parseGmMessage({ t: 'your-turn' })).toBeNull();
    expect(parseGmMessage({ t: 'your-turn', scene: 5 })).toBeNull();
    expect(parseGmMessage({ t: 'your-turn', scene: 'x'.repeat(200) })).toBeNull();
  });

  const HASH = 'ab'.repeat(32);
  const MAC = 'A'.repeat(43);
  const url = (hash = HASH): string => `/api/assets/${hash}?t=${'a'.repeat(26)}.${'b'.repeat(20)}.1760000000000.${MAC}`;

  it('reads pause with a boolean, and nothing else', () => {
    expect(parseGmMessage({ t: 'pause', paused: true })).toEqual({ t: 'pause', paused: true });
    expect(parseGmMessage({ t: 'pause', paused: false })).toEqual({ t: 'pause', paused: false });
    expect(parseGmMessage({ t: 'pause' })).toBeNull();
    expect(parseGmMessage({ t: 'pause', paused: 'yes' })).toBeNull();
  });

  it('reads an asset ticket whose url names the same hash', () => {
    const ticket = { t: 'asset-ticket', hash: HASH, url: url(), expires: 1760000120000 };
    expect(parseGmMessage(ticket)).toEqual(ticket);
    expect(parseGmMessage({ ...ticket, url: url('cd'.repeat(32)) })).toBeNull();
    expect(parseGmMessage({ ...ticket, url: `https://evil${url()}` })).toBeNull();
    expect(parseGmMessage({ ...ticket, url: `https://evil/api/assets/${HASH}?t=x` })).toBeNull();
    expect(parseGmMessage({ ...ticket, expires: 1.5 })).toBeNull();
    expect(parseGmMessage({ ...ticket, expires: '5' })).toBeNull();
    expect(parseGmMessage({ ...ticket, hash: 'A'.repeat(64) })).toBeNull();
  });

  it('exports the level of the new messages', () => {
    expect(PAUSE_LEVEL).toBe(2);
    expect(TICKET_URL_PATTERN.test(url())).toBe(true);
  });

  it('keeps via socket on an asset request and rejects any other via', () => {
    expect(parsePlayerMessage({ t: 'asset-request', hash: HASH, via: 'socket' })).toEqual({ t: 'asset-request', hash: HASH, via: 'socket' });
    expect(parsePlayerMessage({ t: 'asset-request', hash: HASH, via: 'http' })).toBeNull();
  });
});
