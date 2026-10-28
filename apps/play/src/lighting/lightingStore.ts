import { createStore } from 'zustand/vanilla';
import type { LightingState, LightingStore } from '../../../../src/app/pixi/lighting/LightingRenderer';
import type { SceneState } from '../../../../src/app/vision/sceneModel';

export type PlayLightingStore = LightingStore & { apply(state: SceneState, exploredMask: string | null): void };

/**
 * The state the lighting renderer reads, for the player's table: a plain store the messages feed
 * through `apply`. The explored memory is the player's own, so `setExploredMask` and
 * `setExploredEdits` keep local values only. The map counts as loading until the first `apply`.
 */
export function createLightingStore(): PlayLightingStore {
  const store = createStore<LightingState>((set) => ({
    objects: { tokens: {}, walls: {}, lights: {}, lightZones: {}, fog: {}, pins: {}, texts: {}, drawings: {}, audios: {} },
    lighting: { enabled: true, ambient: 0 },
    grid: null,
    heldTokens: {},
    background: null,
    widgetValues: {},
    mapPath: null,
    isMapLoading: true,
    exploredMask: null,
    exploredEdits: 0,
    setExploredMask: (exploredMask: string | null): void => set({ exploredMask }),
    setExploredEdits: (exploredEdits: number): void => set({ exploredEdits }),
  } as unknown as LightingState));
  // The mask the GM last sent: a local memory (`setExploredMask`) is replaced only by a different one.
  let sent: string | null | undefined;
  return Object.assign(store, {
    apply(state: SceneState, exploredMask: string | null): void {
      const mask = exploredMask === sent ? {} : { exploredMask };
      sent = exploredMask;
      store.setState({
        objects: { ...store.getState().objects, ...state.objects },
        lighting: state.lighting,
        grid: state.grid,
        heldTokens: state.heldTokens,
        isMapLoading: false,
        ...mask,
      });
    },
  });
}
