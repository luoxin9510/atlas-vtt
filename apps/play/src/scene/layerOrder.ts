import type { Container } from 'pixi.js';

/** The viewport's children whose order is the scene's, bottom to top. The grid lies just above the map, in its own container. */
export interface SceneLayers {
  readonly map: Container;
  readonly tokens: Container;
  readonly fog: Container;
  readonly pins: Container;
  readonly annotations: Container;
  /** Selection outlines, lifted out of the token containers in a lit scene only. */
  readonly selection: Container;
}

/**
 * z-order of the viewport (`sortableChildren`). The lighting layer (z 90), the sensed outlines
 * (95) and the door badges (96) are the lit scene's own and keep those places.
 *
 * Unlit: map, grid, annotations, pins, tokens, fog (fog covers tokens).
 * Lit: map, grid, tokens (whole, under the lighting), lighting, sensed outlines, door badges,
 * annotations, pins, selection outlines, then the fog (z 100) on top of all of them. The GM sends a
 * drawing or text unless committed fog covers all of it, and relies on the fog to hide the fogged part.
 */
export function orderLayers(lit: boolean, layers: SceneLayers): void {
  layers.map.zIndex = -1;
  if (lit) {
    layers.tokens.zIndex = 10;
    layers.annotations.zIndex = 97;
    layers.pins.zIndex = 98;
    layers.selection.zIndex = 99;
    layers.fog.zIndex = 100;
  } else {
    layers.annotations.zIndex = 10;
    layers.pins.zIndex = 20;
    layers.tokens.zIndex = 30;
    layers.fog.zIndex = 40;
  }
}
