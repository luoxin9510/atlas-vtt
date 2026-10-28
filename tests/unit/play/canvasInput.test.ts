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
  function setup(): { host: HTMLElement; gestures: Gesture[]; camera: boolean[] } {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    document.body.appendChild(host);
    const gestures: Gesture[] = [];
    const camera: boolean[] = [];
    const input = new CanvasInput({
      host, canvas, now: () => 0, tokenAt: () => 'mine', isMine: () => true,
      onGesture: (g) => gestures.push(g), setCameraDrag: (on) => camera.push(on),
    });
    cleanup.push(() => { input.destroy(); host.remove(); });
    return { host, gestures, camera };
  }

  it.each(['pointercancel', 'lostpointercapture'])('%s mid token drag cancels the drag and gives the camera back', (type) => {
    const { host, gestures, camera } = setup();
    fire(host, 'pointerdown', 1, 20, 20);
    expect(camera.at(-1)).toBe(false);
    fire(host, 'pointermove', 1, 60, 20);
    fire(host, type, 1, 60, 20);
    expect(gestures.map((g) => g.kind)).toEqual(['drag-token', 'drag-move', 'drag-cancel']);
    expect(camera.at(-1)).toBe(true);
  });

  it('a normal release after a drag emits drag-end once, even with lostpointercapture after it', () => {
    const { host, gestures } = setup();
    fire(host, 'pointerdown', 1, 20, 20);
    fire(host, 'pointermove', 1, 60, 20);
    fire(host, 'pointerup', 1, 60, 20);
    fire(host, 'lostpointercapture', 1, 60, 20);
    expect(gestures.map((g) => g.kind)).toEqual(['drag-token', 'drag-move', 'drag-end']);
  });

  it('a second finger mid-drag cancels it and re-enables the camera', () => {
    const { host, gestures, camera } = setup();
    fire(host, 'pointerdown', 1, 20, 20);
    fire(host, 'pointermove', 1, 60, 20);
    fire(host, 'pointerdown', 2, 200, 200);
    expect(gestures.map((g) => g.kind)).toEqual(['drag-token', 'drag-move', 'drag-cancel', 'pinch']);
    expect(camera.at(-1)).toBe(true);
  });
});
