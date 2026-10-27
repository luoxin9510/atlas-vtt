import { Sprite, Texture } from 'pixi.js';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import { FogCanvasCompositor } from '../../../../src/app/pixi/fog/FogCanvasCompositor.ts';
import type { PixelRect } from '../../../../src/app/pixi/mapImage/pyramid.ts';
import { sharedFogOperations } from './fogAdapter.ts';

const MAX_CANVAS_SIDE = 4096;

/** The fog picture over a map: Atlas's compositor draws it, one sprite shows it. Opaque black where covered. */
export class FogLayer {
  readonly sprite: Sprite;
  private readonly compositor: FogCanvasCompositor;
  private readonly texture: Texture;

  constructor(bounds: PixelRect) {
    const scale = Math.min(0.5, MAX_CANVAS_SIDE / Math.max(bounds.width, bounds.height));
    this.compositor = new FogCanvasCompositor(bounds, scale);
    this.texture = Texture.from(this.compositor.getCanvas());
    this.sprite = new Sprite(this.texture);
    this.sprite.label = 'fog';
    this.sprite.eventMode = 'none';
    this.sprite.position.set(bounds.x, bounds.y);
    this.sprite.width = bounds.width;
    this.sprite.height = bounds.height;
  }

  /** Redraws for `fog`; an invalid fog covers everything (the compositor does). */
  set(fog: SharedFog): void {
    this.compositor.composite(sharedFogOperations(fog));
    this.texture.source.update();
  }

  destroy(): void {
    this.sprite.destroy({ texture: true, textureSource: true });
    this.compositor.destroy();
  }
}
