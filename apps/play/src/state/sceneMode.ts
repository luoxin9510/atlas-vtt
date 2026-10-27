import type { SharedScene } from '../../../../src/app/online/protocol/game.ts';

/**
 * What the player's table shows: nothing, the map picture of an unlit scene, the map lit by the
 * lighting engine, or the placeholder (a lit scene whose lighting is not ready or cannot run).
 */
export type SceneMode = 'none' | 'unlit' | 'lit' | 'placeholder';

/** Whether this device can light a scene: not asked yet, the probe passed, or it failed or the engine gave up. */
export type LightingSupport = 'unknown' | 'ready' | 'unsupported';

/**
 * Only a scene that says `lit: false` is an unlit map; anything else that is not absent is lit, and
 * is shown only once this device has shown it can light it (fail closed).
 */
export function sceneMode(scene: SharedScene | null, lighting: LightingSupport): SceneMode {
  if (scene === null) return 'none';
  if (scene.lit === false) return 'unlit';
  return lighting === 'ready' ? 'lit' : 'placeholder';
}
