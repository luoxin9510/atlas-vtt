import type { Gesture } from './gestures.ts';
import { GestureRecognizer } from './gestures.ts';

export interface CanvasInputOptions {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  now(): number;
  /** Screen (canvas CSS pixel) point to the id of the token there, if any. */
  tokenAt(x: number, y: number): string | null;
  isMine(id: string): boolean;
  onGesture(g: Gesture): void;
  /** Whether the camera's one-finger drag may run: false while the finger is on a token of the player's. */
  setCameraDrag(on: boolean): void;
}

const TICK_MS = 100;

/**
 * Feeds the pointer events of a canvas to a `GestureRecognizer`. The listeners sit on the host in
 * the capture phase, so the camera is told to hold still before Pixi's own pointerdown reaches it.
 * Right click is a long press and opens no browser menu.
 */
export class CanvasInput {
  private readonly recognizer: GestureRecognizer;
  private readonly down = new Set<number>();
  private readonly timer: number;

  constructor(private readonly options: CanvasInputOptions) {
    this.recognizer = new GestureRecognizer({
      now: options.now,
      tokenAt: options.tokenAt,
      isMine: options.isMine,
      onGesture: options.onGesture,
    });
    const { host } = options;
    host.addEventListener('pointerdown', this.onDown, true);
    host.addEventListener('pointermove', this.onMove, true);
    host.addEventListener('pointerup', this.onUp, true);
    host.addEventListener('pointercancel', this.onCancel, true);
    host.addEventListener('contextmenu', this.onMenu, true);
    // A mouse released outside the host never reaches it (only touch is captured implicitly): the window hears it.
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    this.timer = window.setInterval(() => this.recognizer.tick(), TICK_MS);
  }

  private sample(e: PointerEvent): { id: number; x: number; y: number; button: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top, button: e.button };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const s = this.sample(e);
    if (this.down.size === 0 && s.button === 0) {
      const token = this.options.tokenAt(s.x, s.y);
      if (token !== null && this.options.isMine(token)) this.options.setCameraDrag(false);
    } else if (s.button === 0) {
      this.options.setCameraDrag(true);
    }
    if (s.button === 0) {
      this.down.add(s.id);
      try { this.options.host.setPointerCapture(e.pointerId); } catch { /* not capturable: the window listeners cover it */ }
    }
    this.recognizer.down(s);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.down.has(e.pointerId)) this.recognizer.move(this.sample(e));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.down.delete(e.pointerId)) return;
    this.recognizer.up(this.sample(e));
    if (this.down.size === 0) this.options.setCameraDrag(true);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (!this.down.delete(e.pointerId)) return;
    this.recognizer.cancel(e.pointerId);
    if (this.down.size === 0) this.options.setCameraDrag(true);
  };

  private readonly onMenu = (e: Event): void => {
    e.preventDefault();
  };

  destroy(): void {
    const { host } = this.options;
    host.removeEventListener('pointerdown', this.onDown, true);
    host.removeEventListener('pointermove', this.onMove, true);
    host.removeEventListener('pointerup', this.onUp, true);
    host.removeEventListener('pointercancel', this.onCancel, true);
    host.removeEventListener('contextmenu', this.onMenu, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.clearInterval(this.timer);
  }
}
