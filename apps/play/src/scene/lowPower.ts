export const LOW_POWER_KEY = 'atlas-play:low-power';

/** Low-power is the default on a phone that asks for less motion or has four cores or fewer. */
export function lowPowerDefault(env: { reducedMotion: boolean; cores: number }): boolean {
  return env.reducedMotion || env.cores <= 4;
}

/** The player's saved choice, else the default for this device. */
export function loadLowPower(storage: Pick<Storage, 'getItem'> | null, env: { reducedMotion: boolean; cores: number }): boolean {
  try {
    const saved = storage?.getItem(LOW_POWER_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // Storage may be blocked: the default applies.
  }
  return lowPowerDefault(env);
}

export function saveLowPower(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(LOW_POWER_KEY, String(on));
  } catch {
    // Not kept: the next visit starts from the default.
  }
}

/** The device's own answer, read once at start. */
export function deviceEnv(): { reducedMotion: boolean; cores: number } {
  return {
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    cores: typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency,
  };
}
