import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { NAMEPLATE_HEIGHT, NAMEPLATE_TEXT, tokenTextResolution } from '../../../../src/app/pixi/token-renderer/tokenSizing.ts';
import { destroyTree } from '../../../../src/app/pixi/utils/destroyTree.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import type { SharedBar, SharedCondition } from '../../../../src/app/online/protocol/tokenUI.ts';

const DISC = 0x4a4d5a;
const ACCENT = 0x6aa9ff;
const SELECT = 0xffffff;
const BAR_WIDTH = 56;
const BAR_HEIGHT = 7;
const BAR_GAP = 2;
const DOT = 12;

const colourOf = (hex: string): number => parseInt(hex.slice(1), 16);
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** The fraction a bar is filled to: a static value shows full. */
export function barFill(bar: SharedBar): number {
  if (bar.direction === 'static' || bar.max <= 0) return 1;
  return Math.min(1, Math.max(0, bar.current / bar.max));
}

/** The single character a condition badge shows: its text, or the first letter of its icon's name. */
export function conditionText(condition: SharedCondition): string {
  return condition.glyph.kind === 'text' ? condition.glyph.text : (condition.glyph.icon[0] ?? '?').toUpperCase();
}

/**
 * One token on the table: a container at the token's centre holding a neutral disc, the artwork in a
 * circle (turned by the token's rotation), the ring, the downed veil, the selection outline, the
 * own-token dot and, in UI units that rest at a medium token's scale, the conditions, nameplate and bars.
 * `update` moves the container in place and redraws only the parts whose data changed.
 */
export class TokenView {
  readonly root: Container;
  private readonly body = new Container({ label: 'body' });
  private readonly disc = new Graphics();
  private readonly frame = new Graphics();
  private readonly ui = new Container({ label: 'ui' });
  private readonly rim = new Container({ label: 'conditions' });
  private sprite: Sprite | null = null;
  private drawn: { token: SharedToken; mine: boolean; selected: boolean; scale: number } | null = null;

  constructor(id: string) {
    this.root = new Container({ label: id, eventMode: 'none' });
    this.body.addChild(this.disc);
    this.root.addChild(this.body, this.frame, this.rim, this.ui);
  }

  update(token: SharedToken, mine: boolean, selected: boolean, uiScale: number): void {
    this.root.position.set(token.x, token.y);
    this.body.rotation = radians(token.rotation);
    const before = this.drawn;
    this.drawn = { token, mine, selected, scale: uiScale };
    if (before && before.mine === mine && before.selected === selected && before.scale === uiScale && sameLook(before.token, token)) return;
    this.redraw(token, mine, selected, uiScale);
  }

  /** Puts the loaded artwork in the circle; the sprite covers it whatever the picture's shape. */
  setArt(texture: Texture, size: number): void {
    if (this.root.destroyed) return;
    this.sprite?.destroy();
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    const cover = size / Math.min(texture.width, texture.height);
    sprite.scale.set(cover);
    sprite.mask = this.disc; // the neutral disc is the circle the art is cut to
    this.sprite = sprite;
    this.body.addChild(sprite);
    this.applyDowned();
  }

  /** Back to the neutral disc; the texture stays the cache's to release. */
  clearArt(): void {
    this.sprite?.destroy();
    this.sprite = null;
  }

  /** The texture of the artwork shown, or null on the neutral disc. */
  artTexture(): Texture | null {
    return this.sprite?.texture ?? null;
  }

  private applyDowned(): void {
    if (this.sprite) this.sprite.tint = this.drawn?.token.ui?.downed ? 0x777777 : 0xffffff;
  }

  private redraw(token: SharedToken, mine: boolean, selected: boolean, scale: number): void {
    const radius = token.size / 2;
    const outer = Math.max(radius, (token.ring?.size ?? 0) / 2);
    this.disc.clear().circle(0, 0, radius).fill(token.ui?.downed ? 0x2a2c33 : DISC);
    if (this.sprite) {
      const texture = this.sprite.texture;
      this.sprite.scale.set(token.size / Math.min(texture.width, texture.height));
    }
    this.applyDowned();
    this.frame.clear();
    if (token.ring) {
      const width = Math.max(2, (token.ring.size - token.size) / 2);
      this.frame.circle(0, 0, radius + width / 2).stroke({ color: colourOf(token.ring.colour), width });
    }
    if (token.ui?.downed) this.frame.circle(0, 0, radius).fill({ color: 0x000000, alpha: 0.25 });
    if (selected) this.frame.circle(0, 0, outer + 3).stroke({ color: SELECT, width: 3 });
    if (mine) this.frame.circle(-outer * 0.7, -outer * 0.7, Math.max(4, outer * 0.12)).fill(ACCENT).stroke({ color: 0x000000, width: 1.5 });
    this.drawUi(token, outer, scale);
  }

  private drawUi(token: SharedToken, outer: number, scale: number): void {
    for (const child of [...this.ui.removeChildren(), ...this.rim.removeChildren()]) destroyTree(child);
    const ui = token.ui;
    if (!ui) return;
    this.ui.scale.set(scale);
    this.ui.position.set(0, outer);
    let y = 0;
    if (ui.nameplate && token.name) {
      const text = new Text({ text: token.name, style: { fontFamily: NAMEPLATE_TEXT.fontFamily, fontSize: NAMEPLATE_TEXT.fontSize, fontWeight: NAMEPLATE_TEXT.fontWeight, fill: 0xffffff }, resolution: tokenTextResolution(scale) });
      text.scale.set(NAMEPLATE_TEXT.textScale);
      text.anchor.set(0.5);
      const width = text.width + NAMEPLATE_TEXT.padding * 2;
      const badge = new Graphics().roundRect(-width / 2, 0, width, NAMEPLATE_HEIGHT, NAMEPLATE_HEIGHT / 2).fill({ color: 0x000000, alpha: NAMEPLATE_TEXT.alpha });
      text.position.set(0, NAMEPLATE_HEIGHT / 2);
      this.ui.addChild(badge, text);
      y = NAMEPLATE_HEIGHT + BAR_GAP;
    }
    for (const bar of ui.bars) {
      const g = new Graphics().roundRect(-BAR_WIDTH / 2, y, BAR_WIDTH, BAR_HEIGHT, 2).fill({ color: 0x000000, alpha: 0.7 });
      const filled = BAR_WIDTH * barFill(bar);
      if (filled > 0) g.roundRect(-BAR_WIDTH / 2, y, filled, BAR_HEIGHT, 2).fill(colourOf(bar.colour));
      this.ui.addChild(g);
      y += BAR_HEIGHT + BAR_GAP;
    }
    this.drawConditions(ui.conditions, outer, scale);
  }

  /** Condition dots sit on the rim in world units, from the top going clockwise, a dot's width apart. */
  private drawConditions(conditions: readonly SharedCondition[], outer: number, scale: number): void {
    const diameter = DOT * scale;
    const step = (diameter * 1.1) / Math.max(outer, 1);
    conditions.forEach((condition, i) => {
      const angle = -Math.PI / 2 + step * (i + 0.5);
      const dot = new Container();
      dot.position.set(Math.cos(angle) * outer, Math.sin(angle) * outer);
      dot.addChild(new Graphics().circle(0, 0, diameter / 2).fill(colourOf(condition.colour)).stroke({ color: 0x000000, width: Math.max(1, scale) }));
      const label = new Text({ text: conditionText(condition), style: { fontFamily: NAMEPLATE_TEXT.fontFamily, fontSize: 16, fontWeight: '700', fill: 0xffffff }, resolution: tokenTextResolution(scale) });
      label.anchor.set(0.5);
      label.scale.set(Math.min(1, (diameter * 0.8) / Math.max(label.width, 1)) * scale * 0.5);
      dot.addChild(label);
      this.rim.addChild(dot);
    });
  }

  destroy(): void {
    this.sprite = null;
    destroyTree(this.root);
  }
}

function sameLook(a: SharedToken, b: SharedToken): boolean {
  return a.size === b.size && a.name === b.name && a.ring?.colour === b.ring?.colour && a.ring?.size === b.ring?.size && JSON.stringify(a.ui) === JSON.stringify(b.ui);
}
