import type { Point } from '../../../../src/app/grid/hexGeometry.ts';
import type { PlayerMessage } from '../../../../src/app/online/protocol/index.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';
import type { TableState, TableStore } from '../state/tableStore.ts';
import { snapDrop } from './dropSnap.ts';
import type { Gesture } from './gestures.ts';

/** The most often a `drag` frame is sent (the relay allows 20 frames a second per player). */
export const DRAG_INTERVAL_MS = 100;
/** How long the dropped token is drawn at its drop while the GM's list has yet to show it there. */
export const DROP_PREVIEW_MS = 3000;
/** The list shows a token "at" its drop when it is within this many world pixels. */
const AT_DROP = 0.5;

export interface DragPorts {
  /** Sends a frame; false when it could not be (not connected, too large). */
  send(body: PlayerMessage): boolean;
  store: TableStore;
  /** Screen (canvas) point to world point. */
  toWorld(x: number, y: number): Point;
  now(): number;
  /** Draws the token at a world place instead of the list's; null: the list's again. */
  preview(id: string, at: Point | null): void;
}

interface Active {
  id: string;
  scene: string;
  /** Token centre minus pointer, in world pixels, from the first move: the token keeps the grab. */
  grab: Point | null;
  at: Point;
  unsent: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Dropped { id: string; at: Point; timer: ReturnType<typeof setTimeout> }

/**
 * The player's drag of an own token: it sends the latest point at most every 100 ms, drops with a
 * snapped `move`, and keeps the token drawn at its drop until the GM's list shows it there, the GM
 * refuses the move, or 3 s pass. The GM's answer is authoritative: no wall check here.
 */
export class DragController {
  private active: Active | null = null;
  private dropped: Dropped | null = null;
  /** When the last `drag` frame went out, over all drags: the spacing holds across a drop and a new grab. */
  private lastDragAt = Number.NEGATIVE_INFINITY;
  private readonly unsubscribe: () => void;

  constructor(private readonly ports: DragPorts) {
    this.unsubscribe = ports.store.subscribe((state, before) => this.follow(state, before));
  }

  handle(gesture: Gesture): void {
    switch (gesture.kind) {
      case 'drag-token':
        this.begin(gesture.id);
        return;
      case 'drag-move':
        if (this.active?.id === gesture.id) this.move(this.active, gesture.x, gesture.y);
        return;
      case 'drag-end':
        if (this.active?.id === gesture.id) this.drop(this.active, gesture.x, gesture.y);
        return;
      case 'drag-cancel':
        if (this.active?.id === gesture.id) this.cancel();
        return;
      default:
    }
  }

  /** Ends a drag in progress as a cancel (and any drop preview): the table paused, the view closed. */
  stop(): void {
    this.cancel();
    this.forgetDrop();
  }

  destroy(): void {
    this.stop();
    this.unsubscribe();
  }

  private begin(id: string): void {
    this.cancel();
    const state = this.ports.store.getState();
    const token = state.tokens.find((t) => t.id === id);
    if (!token || !state.mine.has(id) || token.held === true || state.paused || state.scene === null) return;
    this.forgetDrop();
    this.active = { id, scene: state.scene.id, grab: null, at: { x: token.x, y: token.y }, unsent: false, timer: null };
  }

  private move(active: Active, x: number, y: number): void {
    const world = this.ports.toWorld(x, y);
    const token = this.ports.store.getState().tokens.find((t) => t.id === active.id);
    if (!token) return;
    active.grab ??= { x: token.x - world.x, y: token.y - world.y };
    active.at = { x: world.x + active.grab.x, y: world.y + active.grab.y };
    this.ports.preview(active.id, active.at);
    active.unsent = true;
    const wait = this.lastDragAt + DRAG_INTERVAL_MS - this.ports.now();
    if (wait <= 0) this.sendDrag(active);
    else active.timer ??= setTimeout(() => { active.timer = null; if (this.active === active) this.sendDrag(active); }, wait);
  }

  private sendDrag(active: Active): void {
    if (active.timer !== null) clearTimeout(active.timer);
    active.timer = null;
    active.unsent = false;
    this.lastDragAt = this.ports.now();
    const { id, scene, at } = active;
    if (!this.ports.send({ t: 'drag', scene, id, x: at.x, y: at.y })) this.abandon();
  }

  private drop(active: Active, x: number, y: number): void {
    this.move(active, x, y);
    this.clearTimer(active);
    this.active = null;
    const state = this.ports.store.getState();
    const token = state.tokens.find((t) => t.id === active.id);
    if (!token) {
      this.ports.preview(active.id, null);
      return;
    }
    const at = snapDrop(active.at, token, state.snap);
    if (!this.ports.send({ t: 'move', scene: active.scene, id: active.id, x: at.x, y: at.y })) {
      this.ports.preview(active.id, null);
      return;
    }
    this.ports.preview(active.id, at);
    const timer = setTimeout(() => this.forgetDrop(), DROP_PREVIEW_MS);
    this.dropped = { id: active.id, at, timer };
  }

  /** The drag ends with a `drag-cancel`, and the list's place shows again. */
  private cancel(): void {
    const active = this.active;
    if (active === null) return;
    this.abandon();
    this.ports.send({ t: 'drag-cancel', scene: active.scene, id: active.id });
  }

  /** The drag is over without a word to the GM (it could not be reached, or the scene is gone). */
  private abandon(): void {
    const active = this.active;
    if (active === null) return;
    this.clearTimer(active);
    this.active = null;
    this.ports.preview(active.id, null);
  }

  private clearTimer(active: Active): void {
    if (active.timer !== null) clearTimeout(active.timer);
    active.timer = null;
  }

  private forgetDrop(): void {
    const { dropped } = this;
    if (dropped === null) return;
    clearTimeout(dropped.timer);
    this.dropped = null;
    this.ports.preview(dropped.id, null);
  }

  private follow(state: TableState, before: TableState): void {
    const { active, dropped } = this;
    if (state.scene?.id !== before.scene?.id) {
      this.abandon();
      this.forgetDrop();
      return;
    }
    if (state.refused !== before.refused && state.refused !== null) {
      if (active?.id === state.refused.id) this.abandon();
      if (dropped?.id === state.refused.id) this.forgetDrop();
    }
    if (active) {
      const token = state.tokens.find((t) => t.id === active.id);
      if (!token || !state.mine.has(active.id) || token.held === true) this.cancel();
    }
    if (dropped && state.tokens !== before.tokens) {
      const token: SharedToken | undefined = state.tokens.find((t) => t.id === dropped.id);
      if (!token || (Math.abs(token.x - dropped.at.x) <= AT_DROP && Math.abs(token.y - dropped.at.y) <= AT_DROP)) this.forgetDrop();
    }
  }
}
