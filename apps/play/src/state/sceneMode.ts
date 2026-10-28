import type { SharedScene } from '../../../../src/app/online/protocol/game.ts';

/** What the player's table shows: nothing, the placeholder of a lit scene (fail closed), or the map picture. */
export type SceneMode = 'none' | 'lit-placeholder' | 'map';

/** Only a scene that says `lit: false` is drawn; anything else that is not absent fails closed. */
export function sceneMode(scene: SharedScene | null): SceneMode {
  if (scene === null) return 'none';
  return scene.lit !== false ? 'lit-placeholder' : 'map';
}
