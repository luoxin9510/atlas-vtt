import { describe, expect, it } from 'vitest';
import { FORK_APP, FORK_PROTOCOL_LEVEL, parseGmMessage, parsePlayerMessage } from '../../../../src/app/online/protocol/index.ts';

describe('the fork protocol messages', () => {
  it('keeps the fork level apart from upstream\'s', () => {
    expect(FORK_PROTOCOL_LEVEL).toBe(1);
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
});
