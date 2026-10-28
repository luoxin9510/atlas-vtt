export type Gesture =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'long-press'; x: number; y: number }
  | { kind: 'pan' }
  | { kind: 'pinch' }
  | { kind: 'drag-token'; id: string }
  /** The stream of an own-token drag, in screen coordinates: every move, then one of end or cancel. */
  | { kind: 'drag-move'; id: string; x: number; y: number }
  | { kind: 'drag-end'; id: string; x: number; y: number }
  | { kind: 'drag-cancel'; id: string };

export interface PointerSample { id: number; x: number; y: number; button: number }

export interface GestureOptions {
  now(): number;
  tokenAt(x: number, y: number): string | null;
  isMine(id: string): boolean;
  onGesture(g: Gesture): void;
}

export const LONG_PRESS_MS = 500;
export const MOVE_SLOP_PX = 10;

interface Tracked { x: number; y: number; startX: number; startY: number; startedAt: number; token: string | null }

/**
 * Turns pointer events into the gestures the table reacts on. It only classifies: the camera's
 * own panning and zooming is pixi-viewport's. Each press yields at most one gesture, except that a
 * second pointer turns whatever was going on into one `pinch` that lasts until all pointers are up,
 * and a drag of an own token, which streams its moves and ends in `drag-end`, or in `drag-cancel`
 * when a second pointer or the browser takes the press away.
 */
export class GestureRecognizer {
  private readonly pointers = new Map<number, Tracked>();
  /** Of the first pointer: undecided until it is released, moved or held long enough. */
  private pending = false;
  private pinching = false;
  /** The pointer dragging an own token, and the token. */
  private dragging: { pointer: number; token: string } | null = null;

  constructor(private readonly options: GestureOptions) {}

  down(e: PointerSample): void {
    const { x, y } = e;
    if (e.button === 2) {
      this.options.onGesture({ kind: 'long-press', x, y });
      return;
    }
    if (this.pointers.size > 0) {
      this.pending = false;
      this.cancelDrag();
      if (!this.pinching) this.options.onGesture({ kind: 'pinch' });
      this.pinching = true;
      this.pointers.set(e.id, { x, y, startX: x, startY: y, startedAt: this.options.now(), token: null });
      return;
    }
    this.pointers.set(e.id, { x, y, startX: x, startY: y, startedAt: this.options.now(), token: this.options.tokenAt(x, y) });
    this.pending = true;
  }

  move(e: PointerSample): void {
    const p = this.pointers.get(e.id);
    if (!p) return;
    p.x = e.x;
    p.y = e.y;
    if (this.dragging?.pointer === e.id) {
      this.options.onGesture({ kind: 'drag-move', id: this.dragging.token, x: p.x, y: p.y });
      return;
    }
    if (!this.pending || this.pinching) return;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) < MOVE_SLOP_PX) return;
    this.pending = false;
    if (p.token !== null && this.options.isMine(p.token)) {
      this.dragging = { pointer: e.id, token: p.token };
      this.options.onGesture({ kind: 'drag-token', id: p.token });
      this.options.onGesture({ kind: 'drag-move', id: p.token, x: p.x, y: p.y });
    } else {
      this.options.onGesture({ kind: 'pan' });
    }
  }

  up(e: PointerSample): void {
    const p = this.pointers.get(e.id);
    if (!p) return;
    if (this.dragging?.pointer === e.id) {
      const { token } = this.dragging;
      this.dragging = null;
      this.options.onGesture({ kind: 'drag-end', id: token, x: e.x, y: e.y });
    }
    if (this.pending) {
      this.tick();
      if (this.pending) this.options.onGesture({ kind: 'tap', x: p.x, y: p.y });
    }
    this.cancel(e.id);
  }

  /** The browser took the pointer away (pointercancel, lost capture): a drag it held is cancelled. */
  cancel(id: number): void {
    if (this.dragging?.pointer === id) this.cancelDrag();
    this.pointers.delete(id);
    if (this.pointers.size === 0) {
      this.pending = false;
      this.pinching = false;
    }
  }

  private cancelDrag(): void {
    if (this.dragging === null) return;
    const { token } = this.dragging;
    this.dragging = null;
    this.options.onGesture({ kind: 'drag-cancel', id: token });
  }

  /** Called on a timer: a still press held for 500 ms becomes a long press. */
  tick(): void {
    if (!this.pending) return;
    const p = [...this.pointers.values()][0];
    if (!p || this.options.now() - p.startedAt < LONG_PRESS_MS) return;
    this.pending = false;
    this.options.onGesture({ kind: 'long-press', x: p.x, y: p.y });
  }
}
