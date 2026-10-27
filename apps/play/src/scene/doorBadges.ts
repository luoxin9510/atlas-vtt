import { Container, Graphics } from 'pixi.js';
import type { SharedDoor } from '../../../../src/app/online/protocol/mapLayers.ts';

/** Above the sensed outlines (95), below the pins. */
export const DOOR_BADGES_Z_INDEX = 96;

const OPEN = 0x4caf50;
const CLOSED = 0xc0392b;
const RIM = 0x101010;

/** A badge is this share of a grid cell across. */
const BADGE_CELLS = 0.3;

/**
 * The doors the GM shared, as a round badge on the middle of each: green and hollow where open,
 * red and filled where closed. The list is already what the players see; nothing is decided here.
 */
export class DoorBadges {
  readonly container = new Container({ label: 'door-badges', eventMode: 'none', zIndex: DOOR_BADGES_Z_INDEX });
  private readonly graphics = new Graphics();
  private shown: { doors: readonly SharedDoor[]; cell: number } | null = null;

  constructor() {
    this.container.addChild(this.graphics);
  }

  sync(doors: readonly SharedDoor[], cell: number): void {
    if (this.shown?.doors === doors && this.shown.cell === cell) return;
    this.shown = { doors, cell };
    const radius = Math.max(4, cell * BADGE_CELLS) / 2;
    this.graphics.clear();
    for (const { p: [x1, y1, x2, y2], open } of doors) {
      const x = (x1 + x2) / 2;
      const y = (y1 + y2) / 2;
      this.graphics.circle(x, y, radius);
      if (open) this.graphics.stroke({ width: Math.max(1.5, radius / 4), color: OPEN });
      else this.graphics.fill(CLOSED).stroke({ width: Math.max(1.5, radius / 4), color: RIM });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
