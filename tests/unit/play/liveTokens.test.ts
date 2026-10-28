import { describe, expect, it } from 'vitest';
import type { GmMessage } from '../../../src/app/online/protocol/index.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { TokenOverrides } from '../../../apps/play/src/scene/liveTokens.ts';
import { createTableStore } from '../../../apps/play/src/state/tableStore.ts';

const token = (id: string, x = 1, y = 2): SharedToken => ({ id, x, y, size: 50, cells: 1, rotation: 0, art: null, name: id, ring: null }) as SharedToken;
const MAP = { hash: 'a'.repeat(64), size: 10, type: 'image/png' };
const live = (...tokens: Array<{ id: string; x: number; y: number; end?: true }>): GmMessage => ({ t: 'live', scene: 's1', at: 1, tokens }) as GmMessage;

function table(): ReturnType<typeof createTableStore> {
  const store = createTableStore();
  store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP, lit: false } } as unknown as GmMessage, 0);
  store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token('a'), token('b')], cell: 70, snap: null }, 0);
  return store;
}

describe('live places in the store', () => {
  it('keeps the latest place of a token and drops it on end', () => {
    const store = table();
    store.applyMessage(live({ id: 'a', x: 10, y: 11 }), 0);
    store.applyMessage(live({ id: 'a', x: 20, y: 21 }, { id: 'b', x: 5, y: 6 }), 0);
    expect(store.getState().live.get('a')).toEqual({ x: 20, y: 21 });
    expect(store.getState().live.get('b')).toEqual({ x: 5, y: 6 });
    store.applyMessage(live({ id: 'a', x: 30, y: 31, end: true }), 0);
    expect(store.getState().live.has('a')).toBe(false);
    expect(store.getState().live.has('b')).toBe(true);
  });

  it('clears on a scene change and ignores another scene', () => {
    const store = table();
    store.applyMessage({ t: 'live', scene: 'other', at: 1, tokens: [{ id: 'a', x: 1, y: 1 }] } as GmMessage, 0);
    expect(store.getState().live.size).toBe(0);
    store.applyMessage(live({ id: 'a', x: 10, y: 11 }), 0);
    store.applyMessage({ t: 'scene', scene: { id: 's2', map: MAP, lit: false } } as unknown as GmMessage, 0);
    expect(store.getState().live.size).toBe(0);
  });

  it('keeps the snap grid of the tokens message', () => {
    const store = createTableStore();
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP, lit: false } } as unknown as GmMessage, 0);
    const snap = { type: 'square' as const, size: 70, offsetX: 0, offsetY: 0 };
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [], cell: 70, snap }, 0);
    expect(store.getState().snap).toEqual(snap);
  });
});

describe('TokenOverrides', () => {
  it('draws a live place over the list and leaves other tokens as they are', () => {
    const list = [token('a'), token('b')];
    const shown = new TokenOverrides().apply(list, new Map([['a', { x: 40, y: 50 }]]));
    expect(shown[0]).toMatchObject({ id: 'a', x: 40, y: 50 });
    expect(shown[1]).toBe(list[1]);
  });

  it('returns the list itself when nothing is overridden', () => {
    const list = [token('a')];
    expect(new TokenOverrides().apply(list, new Map())).toBe(list);
  });

  it('the local preview wins over the echoes of the same token', () => {
    const overrides = new TokenOverrides();
    overrides.set('a', { x: 7, y: 8 });
    const shown = overrides.apply([token('a'), token('b')], new Map([['a', { x: 40, y: 50 }], ['b', { x: 1, y: 1 }]]));
    expect(shown[0]).toMatchObject({ x: 7, y: 8 });
    expect(shown[1]).toMatchObject({ x: 1, y: 1 });
    overrides.set('a', null);
    expect(overrides.apply([token('a')], new Map([['a', { x: 40, y: 50 }]]))[0]).toMatchObject({ x: 40, y: 50 });
  });
});
