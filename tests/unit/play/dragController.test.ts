import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GmMessage, PlayerMessage } from '../../../src/app/online/protocol/index.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { canDrag, DragController } from '../../../apps/play/src/scene/DragController.ts';
import { createTableStore, type TableStoreApi } from '../../../apps/play/src/state/tableStore.ts';

const MAP = { hash: 'a'.repeat(64), size: 10, type: 'image/png' };
const token = (id: string, extra: Partial<SharedToken> = {}): SharedToken => ({ id, x: 100, y: 100, size: 60, cells: 1, rotation: 0, art: null, name: id, ring: null, ...extra }) as SharedToken;
const SQUARE = { type: 'square' as const, size: 70, offsetX: 0, offsetY: 0 };

let clock = 0;
let sent: PlayerMessage[];
let dragTimes: number[];
let previews: Array<[string, { x: number; y: number } | null]>;
let connected: boolean;
let store: TableStoreApi;
let controller: DragController;

function load(tokens: SharedToken[], snap: typeof SQUARE | null = SQUARE, mine: string[] = ['a']): void {
  store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP, lit: false } } as unknown as GmMessage, 0);
  store.applyMessage({ t: 'tokens', scene: 's1', tokens, cell: 70, snap }, 0);
  store.applyMessage({ t: 'mine', scene: 's1', tokens: mine }, 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  sent = [];
  dragTimes = [];
  previews = [];
  connected = true;
  store = createTableStore();
  controller = new DragController({
    send: (body) => { if (connected) { sent.push(body); if (body.t === 'drag') dragTimes.push(clock); } return connected; },
    store, toWorld: (x, y) => ({ x, y }), now: () => clock,
    preview: (id, at) => previews.push([id, at]),
  });
});
afterEach(() => { controller.destroy(); vi.useRealTimers(); });

const start = (id = 'a', x = 100, y = 100): void => {
  controller.handle({ kind: 'drag-token', id });
  controller.handle({ kind: 'drag-move', id, x, y });
};
const sentOf = (type: string): PlayerMessage[] => sent.filter((m) => m.t === type);

describe('canDrag', () => {
  const rows: Array<[string, SharedToken[], string[], boolean, boolean, boolean]> = [
    ['own and free', [token('a')], ['a'], false, true, true],
    ['paused', [token('a')], ['a'], true, true, false],
    ['held', [token('a', { held: true })], ['a'], false, true, false],
    ['foreign', [token('a')], [], false, true, false],
    ['missing token', [], ['a'], false, true, false],
    ['no scene', [token('a')], ['a'], false, false, false],
  ];
  it.each(rows)('%s', (_name, tokens, mine, paused, withScene, expected) => {
    if (withScene) load(tokens, SQUARE, mine);
    store.setState({ paused });
    expect(canDrag(store.getState(), 'a')).toBe(expected);
    controller.handle({ kind: 'drag-token', id: 'a' });
    controller.handle({ kind: 'drag-move', id: 'a', x: 120, y: 100 });
    expect(sentOf('drag').length > 0).toBe(expected);
  });
});

describe('DragController', () => {
  it('sends at most a drag every 100 ms: moves every 10 ms for 0.9 s are ten drags, ending on the latest point', () => {
    load([token('a')]);
    start();
    for (let i = 1; i <= 90; i++) {
      clock += 10;
      vi.advanceTimersByTime(10);
      controller.handle({ kind: 'drag-move', id: 'a', x: 100 + i, y: 100 });
    }
    const drags = sentOf('drag') as Array<{ x: number; y: number }>;
    expect(drags).toHaveLength(10);
    expect(drags.at(-1)).toMatchObject({ t: 'drag', scene: 's1', id: 'a', x: 189, y: 100 });
  });

  it('keeps consecutive drag frames at least 100 ms apart, also across a drop and a new grab', () => {
    load([token('a')]);
    const wiggle = (steps: number, from: number): void => {
      for (let i = 1; i <= steps; i++) {
        clock += 10;
        vi.advanceTimersByTime(10);
        controller.handle({ kind: 'drag-move', id: 'a', x: from + i, y: 100 });
      }
    };
    start();
    wiggle(25, 100);
    controller.handle({ kind: 'drag-end', id: 'a', x: 125, y: 100 });
    clock += 20;
    vi.advanceTimersByTime(20);
    start('a', 125, 100);
    wiggle(40, 125);
    controller.stop();
    expect(dragTimes.length).toBeGreaterThan(4);
    dragTimes.slice(1).forEach((time, i) => expect(time - dragTimes[i]!).toBeGreaterThanOrEqual(100));
  });

  it('sends the latest point a moment later when the pointer stops inside the 100 ms', () => {
    load([token('a')]);
    start();
    clock += 30;
    vi.advanceTimersByTime(30);
    controller.handle({ kind: 'drag-move', id: 'a', x: 160, y: 100 });
    expect(sentOf('drag')).toHaveLength(1);
    clock += 70;
    vi.advanceTimersByTime(70);
    expect(sentOf('drag')).toHaveLength(2);
    expect(sentOf('drag').at(-1)).toMatchObject({ x: 160, y: 100 });
  });

  it('sends the dragged point unsnapped and keeps the preview on it', () => {
    load([token('a')]);
    start();
    clock = 150;
    controller.handle({ kind: 'drag-move', id: 'a', x: 123.5, y: 77.25 });
    expect(sentOf('drag').at(-1)).toMatchObject({ x: 123.5, y: 77.25 });
    expect(previews.at(-1)).toEqual(['a', { x: 123.5, y: 77.25 }]);
  });

  it('drops with a move at the centre of the square cell and keeps the preview there', () => {
    load([token('a')]);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 139, y: 71 });
    expect(sentOf('move')).toEqual([{ t: 'move', scene: 's1', id: 'a', x: 105, y: 105 }]);
    expect(previews.at(-1)).toEqual(['a', { x: 105, y: 105 }]);
  });

  it('snaps a token with an even footprint to a cell corner', () => {
    load([token('a', { cells: 1.5 })]);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 130, y: 150 });
    expect(sentOf('move')).toEqual([{ t: 'move', scene: 's1', id: 'a', x: 140, y: 140 }]);
  });

  it('sends the raw point when the table does not snap', () => {
    load([token('a')], null);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 139.5, y: 71.5 });
    expect(sentOf('move')).toEqual([{ t: 'move', scene: 's1', id: 'a', x: 139.5, y: 71.5 }]);
  });

  it('keeps the grab: the token does not jump to the pointer', () => {
    load([token('a')], null);
    start('a', 110, 100);
    controller.handle({ kind: 'drag-end', id: 'a', x: 160, y: 130 });
    expect(sentOf('move')).toEqual([{ t: 'move', scene: 's1', id: 'a', x: 150, y: 130 }]);
  });

  it.each([
    ['not mine', [token('b')], 'b'],
    ['held', [token('a', { held: true })], 'a'],
  ])('sends nothing for a token that is %s', (_name, tokens, id) => {
    load(tokens);
    start(id);
    clock = 500;
    controller.handle({ kind: 'drag-move', id, x: 150, y: 150 });
    controller.handle({ kind: 'drag-end', id, x: 150, y: 150 });
    expect(sent).toEqual([]);
    expect(previews).toEqual([]);
  });

  it('sends nothing while the table is paused', () => {
    load([token('a')]);
    store.setState({ paused: true });
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 150, y: 150 });
    expect(sent).toEqual([]);
  });

  it('a move-refused for the token clears the preview and shows the list place', () => {
    load([token('a')]);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 139, y: 71 });
    store.applyMessage({ t: 'move-refused', scene: 's1', id: 'a', x: 100, y: 100, reason: 'turn' }, 0);
    expect(previews.at(-1)).toEqual(['a', null]);
  });

  it('keeps the drop preview until the list shows the token there', () => {
    load([token('a')]);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 139, y: 71 });
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token('a', { x: 3, y: 3 })], cell: 70, snap: SQUARE }, 0);
    expect(previews.at(-1)).toEqual(['a', { x: 105, y: 105 }]);
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token('a', { x: 105, y: 105 })], cell: 70, snap: SQUARE }, 0);
    expect(previews.at(-1)).toEqual(['a', null]);
  });

  it('gives up the drop preview after 3 s', () => {
    load([token('a')]);
    start();
    controller.handle({ kind: 'drag-end', id: 'a', x: 139, y: 71 });
    vi.advanceTimersByTime(2999);
    expect(previews.at(-1)).toEqual(['a', { x: 105, y: 105 }]);
    vi.advanceTimersByTime(1);
    expect(previews.at(-1)).toEqual(['a', null]);
  });

  it('a drag-cancel gesture sends drag-cancel and clears the preview', () => {
    load([token('a')]);
    start();
    controller.handle({ kind: 'drag-cancel', id: 'a' });
    expect(sentOf('drag-cancel')).toEqual([{ t: 'drag-cancel', scene: 's1', id: 'a' }]);
    expect(previews.at(-1)).toEqual(['a', null]);
    controller.handle({ kind: 'drag-end', id: 'a', x: 1, y: 1 });
    expect(sentOf('move')).toEqual([]);
  });

  it('stop() mid-drag sends drag-cancel once', () => {
    load([token('a')]);
    start();
    controller.stop();
    controller.stop();
    expect(sentOf('drag-cancel')).toEqual([{ t: 'drag-cancel', scene: 's1', id: 'a' }]);
    expect(previews.at(-1)).toEqual(['a', null]);
  });

  it('a send that fails mid-drag clears the preview without throwing', () => {
    load([token('a')]);
    start();
    connected = false;
    clock = 500;
    expect(() => controller.handle({ kind: 'drag-move', id: 'a', x: 150, y: 150 })).not.toThrow();
    expect(previews.at(-1)).toEqual(['a', null]);
    expect(() => controller.handle({ kind: 'drag-end', id: 'a', x: 150, y: 150 })).not.toThrow();
    expect(sentOf('move')).toEqual([]);
  });

  it('a failed move send clears the drop preview', () => {
    load([token('a')]);
    start();
    connected = false;
    controller.handle({ kind: 'drag-end', id: 'a', x: 150, y: 150 });
    expect(previews.at(-1)).toEqual(['a', null]);
  });

  it('cancels (sending nothing) when the scene changes mid-drag', () => {
    load([token('a')]);
    start();
    store.applyMessage({ t: 'scene', scene: { id: 's2', map: MAP, lit: false } } as unknown as GmMessage, 0);
    expect(previews.at(-1)).toEqual(['a', null]);
    expect(sentOf('drag-cancel')).toEqual([]);
  });
});
