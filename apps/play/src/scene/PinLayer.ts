import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { SharedPin } from '../../../../src/app/online/protocol/mapLayers.ts';
import { MAP_ICON_SIZE } from '../../../../src/app/pixi/mapIcons.ts';
import { createGlyphTexture } from '../../../../src/app/pixi/utils/pinIconTexture.ts';
import { destroyTree } from '../../../../src/app/pixi/utils/destroyTree.ts';
import { PIN_ICON_PATHS, resolvePinIcon, getPinIconDefinition, type PinIconId } from '../../../../src/app/types/pinIcons.ts';
import { isPinLabelKind } from '../../../../src/app/tools/pinLabels.ts';

const LABEL_TONE = '#e3b341';
const FALLBACK_TONE = '#a3abb5';

function toneOf(icon: PinIconId): string {
  try {
    return getPinIconDefinition(icon).tone.dark;
  } catch {
    return FALLBACK_TONE;
  }
}

interface Shown { container: Container; pin: SharedPin; diameter: number }

/** The pins the GM made readable: a tinted badge with the pin's glyph, or its number or letter. Moved in place. */
export class PinLayer {
  readonly container = new Container({ label: 'pin-layer', eventMode: 'none' });
  private readonly shown = new Map<string, Shown>();
  private readonly glyphs = new Map<PinIconId, Texture | null>();

  /** `cell`: the grid cell in world pixels, which a pin's size follows; 0 uses the icon footprint. */
  sync(pins: readonly SharedPin[], cell = 0): void {
    const diameter = cell > 0 ? Math.max(20, cell * 0.6) : MAP_ICON_SIZE * 0.6;
    const keep = new Set(pins.map((pin) => pin.id));
    for (const [id, entry] of this.shown) {
      if (keep.has(id)) continue;
      destroyTree(entry.container);
      this.shown.delete(id);
    }
    for (const pin of pins) {
      let entry = this.shown.get(pin.id);
      if (entry && (entry.diameter !== diameter || entry.pin.icon !== pin.icon || entry.pin.label !== pin.label)) {
        destroyTree(entry.container);
        entry = undefined;
      }
      if (!entry) {
        entry = { container: this.build(pin, diameter), pin, diameter };
        this.shown.set(pin.id, entry);
        this.container.addChild(entry.container);
      }
      entry.pin = pin;
      entry.container.position.set(pin.x, pin.y);
    }
  }

  private build(pin: SharedPin, diameter: number): Container {
    const view = new Container({ label: pin.id });
    const resolved = resolvePinIcon(pin.icon);
    const tone = isPinLabelKind(resolved) ? LABEL_TONE : toneOf(resolved);
    view.addChild(new Graphics().circle(0, 0, diameter / 2).fill({ color: '#101114', alpha: 0.85 }).stroke({ color: tone, width: Math.max(2, diameter / 12) }));
    if (isPinLabelKind(resolved)) {
      const text = new Text({ text: pin.label ?? '', style: { fontSize: diameter * 0.55, fontWeight: '700', fill: tone } });
      text.anchor.set(0.5);
      view.addChild(text);
      return view;
    }
    const texture = this.glyph(resolved);
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = diameter * 0.62;
      sprite.tint = tone;
      view.addChild(sprite);
    }
    return view;
  }

  private glyph(icon: PinIconId): Texture | null {
    if (!this.glyphs.has(icon)) this.glyphs.set(icon, createGlyphTexture(PIN_ICON_PATHS[icon]));
    return this.glyphs.get(icon) ?? null;
  }

  destroy(): void {
    for (const entry of this.shown.values()) destroyTree(entry.container);
    this.shown.clear();
    for (const texture of this.glyphs.values()) texture?.destroy(true);
    this.glyphs.clear();
    destroyTree(this.container);
  }
}
