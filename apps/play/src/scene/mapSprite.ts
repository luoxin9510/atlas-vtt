import { Container, Sprite, Texture } from 'pixi.js';
import type { MapImageChange, MapImageView } from '../../../../src/app/pixi/mapImage/mapImageView.ts';
import type { PixelRect } from '../../../../src/app/pixi/mapImage/pyramid.ts';

/** The map picture of one scene: one sprite at (0, 0), drawn at the world size the GM named. */
export class MapSprite implements MapImageView {
  readonly layer = new Container({ label: 'map', eventMode: 'none' });
  private bitmap: ImageBitmap | null = null;
  private sprite: Sprite | null = null;
  private rect: PixelRect | null = null;
  private size: { width: number; height: number } | null = null;
  private readonly listeners = new Set<(change: MapImageChange) => void>();

  get worldRect(): PixelRect | null {
    return this.rect;
  }

  get imageSize(): { width: number; height: number } | null {
    return this.size;
  }

  /** `world`: the size to draw at; null draws the image at its own pixel size. */
  show(bitmap: ImageBitmap, world: { width: number; height: number } | null): void {
    this.clear(false);
    const width = world?.width ?? bitmap.width;
    const height = world?.height ?? bitmap.height;
    const sprite = new Sprite(Texture.from(bitmap));
    sprite.width = width;
    sprite.height = height;
    this.layer.addChild(sprite);
    this.bitmap = bitmap;
    this.sprite = sprite;
    this.size = { width: bitmap.width, height: bitmap.height };
    this.rect = { x: 0, y: 0, width, height };
    this.emit('image');
  }

  clear(notify = true): void {
    if (this.sprite) {
      this.layer.removeChild(this.sprite);
      this.sprite.destroy({ texture: true, textureSource: true });
    }
    this.bitmap?.close();
    this.sprite = null;
    this.bitmap = null;
    this.rect = null;
    this.size = null;
    if (notify) this.emit('image');
  }

  async overview(maxSide: number): Promise<ImageBitmap | null> {
    const source = this.bitmap;
    if (!source) return null;
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    return createImageBitmap(source, {
      resizeWidth: Math.max(1, Math.round(source.width * scale)),
      resizeHeight: Math.max(1, Math.round(source.height * scale)),
      resizeQuality: 'medium',
    });
  }

  onChange(listener: (change: MapImageChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  destroy(): void {
    this.clear(false);
    this.listeners.clear();
    this.layer.destroy({ children: true });
  }

  private emit(change: MapImageChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}
