import { beforeEach, describe, expect, it } from 'vitest';
import { GestureRecognizer, type Gesture } from '../../../apps/play/src/scene/gestures.ts';

let time = 0;
let seen: Gesture[] = [];
let recognizer: GestureRecognizer;

beforeEach(() => {
  time = 0;
  seen = [];
  recognizer = new GestureRecognizer({
    now: () => time,
    tokenAt: (x, y) => (x < 50 && y < 50 ? 'mine' : x >= 100 && x < 150 ? 'theirs' : null),
    canDrag: (id) => id === 'mine',
    onGesture: (g) => seen.push(g),
  });
});

const p = (id: number, x: number, y: number, button = 0): { id: number; x: number; y: number; button: number } => ({ id, x, y, button });

describe('GestureRecognizer', () => {
  it('taps on a short press that barely moves', () => {
    recognizer.down(p(1, 200, 200));
    time = 100;
    recognizer.move(p(1, 203, 200));
    recognizer.up(p(1, 203, 200));
    expect(seen).toEqual([{ kind: 'tap', x: 203, y: 200 }]);
  });

  it('long-presses after 500 ms without moving and the release is no tap', () => {
    recognizer.down(p(1, 200, 200));
    time = 499;
    recognizer.tick();
    expect(seen).toEqual([]);
    time = 500;
    recognizer.tick();
    recognizer.up(p(1, 200, 200));
    expect(seen).toEqual([{ kind: 'long-press', x: 200, y: 200 }]);
  });

  it('pans once the pointer moves 12 px', () => {
    recognizer.down(p(1, 200, 200));
    recognizer.move(p(1, 212, 200));
    recognizer.move(p(1, 260, 200));
    recognizer.up(p(1, 260, 200));
    expect(seen).toEqual([{ kind: 'pan' }]);
  });

  it('a pointer that moved cannot become a long press', () => {
    recognizer.down(p(1, 200, 200));
    recognizer.move(p(1, 215, 200));
    time = 900;
    recognizer.tick();
    expect(seen).toEqual([{ kind: 'pan' }]);
  });

  it('two pointers are one pinch', () => {
    recognizer.down(p(1, 200, 200));
    recognizer.down(p(2, 300, 200));
    recognizer.move(p(1, 150, 200));
    recognizer.up(p(2, 300, 200));
    recognizer.up(p(1, 150, 200));
    expect(seen).toEqual([{ kind: 'pinch' }]);
  });

  it('a moving finger on an own token drags it', () => {
    recognizer.down(p(1, 10, 10));
    recognizer.move(p(1, 40, 10));
    expect(seen).toEqual([{ kind: 'drag-token', id: 'mine' }, { kind: 'drag-move', id: 'mine', x: 40, y: 10 }]);
  });

  it('a moving finger on another player\'s token pans', () => {
    recognizer.down(p(1, 120, 10));
    recognizer.move(p(1, 160, 10));
    expect(seen).toEqual([{ kind: 'pan' }]);
  });

  it('the right button is a long press at once', () => {
    recognizer.down(p(1, 77, 88, 2));
    expect(seen).toEqual([{ kind: 'long-press', x: 77, y: 88 }]);
  });

  it('a cancelled pointer ends the press without a tap', () => {
    recognizer.down(p(1, 200, 200));
    recognizer.cancel(1);
    recognizer.up(p(1, 200, 200));
    expect(seen).toEqual([]);
  });
  it('an own token that may not be dragged pans', () => {
    const local: Gesture[] = [];
    const r = new GestureRecognizer({ now: () => 0, tokenAt: () => 'mine', canDrag: () => false, onGesture: (g) => local.push(g) });
    r.down(p(1, 10, 10));
    r.move(p(1, 40, 10));
    expect(local.map((g) => g.kind)).toEqual(['pan']);
  });

  describe('dragging an own token', () => {
    const drag = (): void => {
      recognizer.down(p(1, 10, 10));
      recognizer.move(p(1, 30, 10));
    };

    it('streams drag-token, drag-moves and drag-end in screen coordinates', () => {
      drag();
      recognizer.move(p(1, 40, 12));
      recognizer.up(p(1, 45, 14));
      expect(seen).toEqual([
        { kind: 'drag-token', id: 'mine' }, { kind: 'drag-move', id: 'mine', x: 30, y: 10 },
        { kind: 'drag-move', id: 'mine', x: 40, y: 12 }, { kind: 'drag-end', id: 'mine', x: 45, y: 14 },
      ]);
    });

    it('a second finger mid-drag cancels the drag, then pinches', () => {
      drag();
      seen.length = 0;
      recognizer.down(p(2, 200, 200));
      recognizer.move(p(1, 50, 10));
      recognizer.up(p(1, 50, 10));
      expect(seen).toEqual([{ kind: 'drag-cancel', id: 'mine' }, { kind: 'pinch' }]);
    });

    it('pointercancel yields drag-cancel and no drag-end', () => {
      drag();
      seen.length = 0;
      recognizer.cancel(1);
      recognizer.up(p(1, 50, 10));
      expect(seen).toEqual([{ kind: 'drag-cancel', id: 'mine' }]);
    });

    it('a pan or another player token streams nothing', () => {
      recognizer.down(p(1, 120, 10));
      recognizer.move(p(1, 160, 10));
      recognizer.up(p(1, 160, 10));
      expect(seen).toEqual([{ kind: 'pan' }]);
    });
  });
});
