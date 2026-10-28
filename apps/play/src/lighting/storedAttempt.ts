import type { LightingAttempt } from '../../../../src/app/pixi/lighting/lightingAttempts.ts';

export const LIGHTING_ATTEMPT_KEY = 'atlas-play:lighting-attempt';
/** A note this old is a tab someone closed, not a crash loop (a crash is reloaded within seconds). */
export const ATTEMPT_STALE_MS = 10 * 60_000;

/**
 * The crash-loop breaker for lighting on this device. A graphics process that dies while the
 * engine builds a scene takes the page with it and the next load would die the same way, so an
 * attempt is noted before the first build and the note removed after the first lit frame. A note
 * found at the next start (and `begin` after it, with no `finish`) means that attempt never
 * finished: do not start. Storage that cannot be read or written allows the attempt
 * (a crash cannot be told from a first start); the page's own memory still refuses a second begin before a finish.
 */
export function storedLightingAttempt(storage: Storage | null, now: () => number = Date.now): LightingAttempt {
  let open = false;
  const read = (): number | null => {
    const raw = storage?.getItem(LIGHTING_ATTEMPT_KEY);
    const at = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  };
  return {
    begin(): boolean {
      if (open) return false;
      try {
        const noted = read();
        if (noted !== null && now() - noted < ATTEMPT_STALE_MS) return false;
        storage?.setItem(LIGHTING_ATTEMPT_KEY, String(now()));
      } catch {
        // The note cannot be kept, so a crash cannot be told from a first start: allow it; this page's own memory still refuses a second begin before a finish.
      }
      open = true;
      return true;
    },
    finish(): void {
      if (!open) return;
      open = false;
      try {
        storage?.removeItem(LIGHTING_ATTEMPT_KEY);
      } catch {
        // Nothing to take back.
      }
    },
  };
}
