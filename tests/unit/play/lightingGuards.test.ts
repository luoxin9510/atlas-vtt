import { describe, expect, it } from 'vitest';
import { canRunLighting } from '../../../apps/play/src/lighting/lightingProbe.ts';
import { ATTEMPT_STALE_MS, LIGHTING_ATTEMPT_KEY, storedLightingAttempt } from '../../../apps/play/src/lighting/storedAttempt.ts';

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as unknown as Storage;
}

describe('storedLightingAttempt', () => {
  it('refuses a begun attempt that never finished, on the next page load', () => {
    const storage = memory();
    expect(storedLightingAttempt(storage).begin()).toBe(true);
    expect(storage.getItem(LIGHTING_ATTEMPT_KEY)).not.toBeNull();
    // A new page: a new attempt object over the same storage.
    expect(storedLightingAttempt(storage).begin()).toBe(false);
  });

  it('allows a new attempt after a finished one and clears the note', () => {
    const storage = memory();
    const attempt = storedLightingAttempt(storage);
    expect(attempt.begin()).toBe(true);
    attempt.finish();
    expect(storage.getItem(LIGHTING_ATTEMPT_KEY)).toBeNull();
    expect(storedLightingAttempt(storage).begin()).toBe(true);
  });

  it('refuses a second begin before a finish (a restored context)', () => {
    const attempt = storedLightingAttempt(memory());
    expect(attempt.begin()).toBe(true);
    expect(attempt.begin()).toBe(false);
  });

  it('forgets a note left long ago', () => {
    const storage = memory();
    let clock = 1_000;
    storedLightingAttempt(storage, () => clock).begin();
    clock += ATTEMPT_STALE_MS + 1;
    expect(storedLightingAttempt(storage, () => clock).begin()).toBe(true);
  });

  it('reads storage errors, and no storage, as allowed', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    const attempt = storedLightingAttempt(broken);
    expect(attempt.begin()).toBe(true);
    expect(attempt.begin()).toBe(false);
    attempt.finish();
    expect(storedLightingAttempt(null).begin()).toBe(true);
  });
});

describe('canRunLighting', () => {
  it('is false for a renderer without WebGL2', () => {
    expect(canRunLighting({} as never)).toBe(false);
    expect(canRunLighting({ gl: {} } as never)).toBe(false);
  });

  it('keeps its answer per renderer', () => {
    const renderer = { get gl(): never { throw new Error('once'); } } as never;
    expect(canRunLighting(renderer)).toBe(false);
    expect(canRunLighting(renderer)).toBe(false);
  });
});
