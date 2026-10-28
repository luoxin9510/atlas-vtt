import { describe, expect, it } from 'vitest';
import type { GmMessage, SharedScene } from '../../../src/app/online/protocol/index.ts';
import { lowPowerDefault, loadLowPower, LOW_POWER_KEY } from '../../../apps/play/src/scene/lowPower.ts';
import { mapRequest } from '../../../apps/play/src/scene/mapRequest.ts';
import { createTableStore } from '../../../apps/play/src/state/tableStore.ts';

const MAP = { hash: 'a'.repeat(64), size: 10, mime: 'image/png' } as SharedScene['map'];
const scene = (id: string, lit: boolean): GmMessage => ({ t: 'scene', scene: { id, map: MAP, lit } });

describe('mapRequest', () => {
  it('never requests a lit scene\'s map', () => {
    const store = createTableStore();
    store.applyMessage(scene('s1', true), 0);
    expect(mapRequest(store.getState(), false, 16384)).toBeNull();
    store.applyMessage(scene('s2', false), 0);
    expect(mapRequest(store.getState(), false, 16384)).toEqual({ ref: MAP, maxSide: 8192 });
    // The scene turns lit: the request goes away again.
    store.applyMessage(scene('s2', true), 0);
    expect(mapRequest(store.getState(), false, 16384)).toBeNull();
  });

  it('asks for 4096 in low-power mode and no more than the renderer holds otherwise', () => {
    const store = createTableStore();
    store.applyMessage(scene('s1', false), 0);
    expect(mapRequest(store.getState(), true, 16384)?.maxSide).toBe(4096);
    expect(mapRequest(store.getState(), false, 4096)?.maxSide).toBe(4096);
    expect(mapRequest(store.getState(), false, 2048)?.maxSide).toBe(2048);
  });

  it('asks for 4096 at most on a touch device (coarse pointer) even with low-power mode off', () => {
    const store = createTableStore();
    store.applyMessage(scene('s1', false), 0);
    expect(mapRequest(store.getState(), false, 16384, true)?.maxSide).toBe(4096);
    expect(mapRequest(store.getState(), false, 2048, true)?.maxSide).toBe(2048);
    expect(mapRequest(store.getState(), false, 16384, false)?.maxSide).toBe(8192);
  });

  it('asks for nothing without a scene or a map', () => {
    const store = createTableStore();
    expect(mapRequest(store.getState(), false, 8192)).toBeNull();
    store.applyMessage({ t: 'scene', scene: { id: 's', map: null, lit: false } }, 0);
    expect(mapRequest(store.getState(), false, 8192)).toBeNull();
  });
});

describe('low-power mode', () => {
  it('defaults on for reduced motion or four cores or fewer', () => {
    expect(lowPowerDefault({ reducedMotion: true, cores: 16 })).toBe(true);
    expect(lowPowerDefault({ reducedMotion: false, cores: 4 })).toBe(true);
    expect(lowPowerDefault({ reducedMotion: false, cores: 8 })).toBe(false);
  });

  it('prefers the saved choice', () => {
    const env = { reducedMotion: false, cores: 2 };
    expect(loadLowPower({ getItem: (k) => (k === LOW_POWER_KEY ? 'false' : null) }, env)).toBe(false);
    expect(loadLowPower({ getItem: () => null }, env)).toBe(true);
    expect(loadLowPower({ getItem: () => { throw new Error('blocked'); } }, env)).toBe(true);
  });
});
