import { describe, expect, it } from 'vitest';
import type { GmMessage, SharedScene } from '../../../src/app/online/protocol/index.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { sceneMode } from '../../../apps/play/src/state/sceneMode.ts';
import { createTableStore } from '../../../apps/play/src/state/tableStore.ts';

const MAP = { hash: 'a'.repeat(64), size: 10, type: 'image/png' } as unknown as SharedScene['map'];
const scene = (id: string, lit: boolean): SharedScene => ({ id, map: MAP, lit });
const token = (id: string): SharedToken => ({ id, x: 1, y: 2, size: 50, cells: 1, rotation: 0, art: null, name: id, ring: null }) as SharedToken;
const tokens = (sceneId: string, ids: string[]): GmMessage => ({ t: 'tokens', scene: sceneId, tokens: ids.map(token), cell: 70, snap: null });
const fog = (sceneId: string): GmMessage => ({ t: 'fog', scene: sceneId, fog: [] });

function unlitTable(id = 's1'): ReturnType<typeof createTableStore> {
  const store = createTableStore();
  store.applyMessage({ t: 'scene', scene: scene(id, false) }, 0);
  return store;
}

describe('sceneMode', () => {
  it('maps null, unlit and lit scenes by the probe state', () => {
    for (const lighting of ['unknown', 'ready', 'unsupported'] as const) {
      expect(sceneMode(null, lighting)).toBe('none');
      expect(sceneMode(scene('a', false), lighting)).toBe('unlit');
    }
    expect(sceneMode(scene('a', true), 'unknown')).toBe('placeholder');
    expect(sceneMode(scene('a', true), 'unsupported')).toBe('placeholder');
    expect(sceneMode(scene('a', true), 'ready')).toBe('lit');
  });
  it('fails closed on a scene whose lit is not false', () => {
    const unmarked = { id: 'a', map: null } as unknown as SharedScene;
    expect(sceneMode(unmarked, 'unknown')).toBe('placeholder');
    expect(sceneMode(unmarked, 'unsupported')).toBe('placeholder');
    expect(sceneMode(unmarked, 'ready')).toBe('lit');
  });
});

describe('table store', () => {
  it('keeps the layers of an unlit scene', () => {
    const store = unlitTable();
    store.applyMessage(tokens('s1', ['t1', 't2']), 0);
    store.applyMessage(fog('s1'), 0);
    store.applyMessage({ t: 'annotations', scene: 's1', drawings: [], texts: [] }, 0);
    const state = store.getState();
    expect(state.mode).toBe('unlit');
    expect(state.tokens.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(state.cell).toBe(70);
    expect(state.fog).toEqual([]);
  });

  it('drops the unlit picture when the scene turns lit', () => {
    const store = unlitTable();
    store.applyMessage(tokens('s1', ['t1']), 0);
    store.applyMessage(fog('s1'), 0);
    store.applyMessage({ t: 'mine', scene: 's1', tokens: ['t1'] }, 0);
    store.select('t1');
    store.applyMessage({ t: 'scene', scene: scene('s1', true) }, 0);
    store.setLighting('unsupported');
    let state = store.getState();
    expect(state.mode).toBe('placeholder');
    expect(state.tokens).toEqual([]);
    expect(state.fog).toBeUndefined();
    expect(state.mine.size).toBe(0);
    expect(state.selected).toBeNull();
    store.applyMessage(tokens('s1', ['t9']), 0);
    store.applyMessage(fog('s1'), 0);
    store.applyMessage({ t: 'your-turn', scene: 's1' }, 5);
    state = store.getState();
    expect(state.tokens).toEqual([]);
    expect(state.fog).toBeUndefined();
    expect(state.yourTurnAt).toBeNull();
  });

  it('keeps nothing of a scene that arrives lit on a device that cannot light it', () => {
    const store = createTableStore();
    store.setLighting('unsupported');
    store.applyMessage({ t: 'scene', scene: scene('L', true) }, 0);
    store.applyMessage(tokens('L', ['t1']), 0);
    expect(store.getState().tokens).toEqual([]);
    expect(store.getState().mode).toBe('placeholder');
  });

  it('holds a lit scene\'s layers until the probe passes, then turns lit without a resend', () => {
    const store = createTableStore();
    store.applyMessage({ t: 'scene', scene: scene('L', true) }, 0);
    store.applyMessage(tokens('L', ['t1']), 0);
    store.applyMessage(fog('L'), 0);
    expect(store.getState().mode).toBe('placeholder');
    store.setLighting('ready');
    expect(store.getState().mode).toBe('lit');
    expect(store.getState().tokens.map((t) => t.id)).toEqual(['t1']);
    expect(store.getState().fog).toEqual([]);
    // The verdict outlives the scene: the next lit scene is lit at once, and an unlit one stays unlit.
    store.applyMessage({ t: 'scene', scene: scene('M', true) }, 0);
    expect(store.getState().mode).toBe('lit');
    store.setLighting('unsupported');
    expect(store.getState().mode).toBe('placeholder');
    store.applyMessage({ t: 'scene', scene: scene('N', false) }, 0);
    expect(store.getState().mode).toBe('unlit');
  });

  it('keeps the lighting inputs of a lit scene and clears them with the scene', () => {
    const store = createTableStore();
    store.applyMessage({ t: 'scene', scene: scene('L', true) }, 0);
    store.applyMessage({ t: 'doors', scene: 'L', doors: [{ p: [0, 0, 1, 1], open: true }] }, 0);
    expect(store.getState().lit.doors).toHaveLength(1);
    store.applyMessage({ t: 'scene', scene: scene('L', true) }, 0);
    expect(store.getState().lit.doors).toEqual([]);
  });

  it('ignores messages of another scene id', () => {
    const store = unlitTable();
    store.applyMessage(tokens('other', ['x']), 0);
    store.applyMessage({ t: 'mine', scene: 'other', tokens: ['x'] }, 0);
    store.applyMessage({ t: 'your-turn', scene: 'other' }, 9);
    const state = store.getState();
    expect(state.tokens).toEqual([]);
    expect(state.mine.size).toBe(0);
    expect(state.yourTurnAt).toBeNull();
  });

  it('ignores scene messages before any scene is shared', () => {
    const store = createTableStore();
    store.applyMessage(tokens('s1', ['t1']), 0);
    expect(store.getState().tokens).toEqual([]);
  });

  it('clears the scene layer on a scene with another id, keeps it on a resend', () => {
    const store = unlitTable();
    store.applyMessage(tokens('s1', ['t1']), 0);
    store.applyMessage({ t: 'scene', scene: scene('s1', false) }, 0);
    expect(store.getState().tokens).toHaveLength(1);
    store.applyMessage({ t: 'scene', scene: scene('s2', false) }, 0);
    expect(store.getState().tokens).toEqual([]);
    expect(store.getState().fog).toBeUndefined();
    store.applyMessage({ t: 'scene', scene: null }, 0);
    expect(store.getState().mode).toBe('none');
  });

  it('sets mine, your-turn and its dismissal', () => {
    const store = unlitTable();
    store.applyMessage({ t: 'mine', scene: 's1', tokens: ['a', 'b'] }, 0);
    expect([...store.getState().mine]).toEqual(['a', 'b']);
    store.applyMessage({ t: 'your-turn', scene: 's1' }, 42);
    expect(store.getState().yourTurnAt).toBe(42);
    store.dismissYourTurn();
    expect(store.getState().yourTurnAt).toBeNull();
  });

  it('records a roll refusal even while a lit placeholder shows', () => {
    const store = createTableStore();
    store.applyMessage({ t: 'scene', scene: scene('L', true) }, 0);
    store.applyMessage({ t: 'roll-refused', reason: 'rate' }, 0);
    expect(store.getState().rollRefusal).toBe('rate');
  });

  it('drops a selection whose token left the list', () => {
    const store = unlitTable();
    store.applyMessage(tokens('s1', ['t1', 't2']), 0);
    store.select('t2');
    store.applyMessage(tokens('s1', ['t1']), 0);
    expect(store.getState().selected).toBeNull();
  });

  it('ignores types M3 does not use', () => {
    const store = unlitTable();
    const before = store.getState();
    store.applyMessage({ t: 'doors', scene: 's1', doors: [] }, 0);
    store.applyMessage({ t: 'widgets', scene: 's1', bar: null }, 0);
    expect(store.getState()).toBe(before);
  });

  it('tracks the socket status, own id and code', () => {
    const store = createTableStore();
    store.setStatus({ kind: 'joined', id: 'p1', gmOnline: true });
    store.setOwnCode('ABC');
    expect(store.getState()).toMatchObject({ self: 'p1', ownCode: 'ABC' });
  });
});
