// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasInput } from '../../../apps/play/src/scene/canvasInput.ts';
import type { Gesture } from '../../../apps/play/src/scene/gestures.ts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const undo of cleanup.splice(0)) undo(); });

function fire(target: EventTarget, type: string, id: number, x: number, y: number, button = 0): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
  Object.assign(event, { pointerId: id });
  target.dispatchEvent(event);
}

describe('CanvasInput', () => {
  it('a mouse released outside the host ends the press, so the next press is a tap and no pinch (nothing else is emitted)', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);
    const gestures: Gesture[] = [];
    const resumed: boolean[] = [];
    const input = new CanvasInput({
      host, canvas, now: () => 0, tokenAt: () => null, isMine: () => false,
      onGesture: (g) => gestures.push(g), setCameraDrag: (on) => resumed.push(on),
    });
    cleanup.push(() => { input.destroy(); host.remove(); });

    fire(host, 'pointerdown', 1, 20, 20);
    fire(window, 'pointerup', 1, 400, 400);
    fire(host, 'pointerdown', 1, 30, 30);
    fire(host, 'pointerup', 1, 30, 30);
    expect(gestures.map((g) => g.kind)).toEqual(['tap', 'tap']);
    expect(resumed.at(-1)).toBe(true);
  });
});
