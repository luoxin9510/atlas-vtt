import { describe, expect, it } from 'vitest';
import { fogCoverage } from '../../../src/app/fog/fogCoverage.ts';
import type { SharedFog } from '../../../src/app/online/protocol/fog.ts';
import { sharedFogOperations } from '../../../apps/play/src/scene/fogAdapter.ts';

describe('sharedFogOperations', () => {
  it('turns a flat brush into points and keeps its radius', () => {
    const ops = sharedFogOperations([{ id: 'a', type: 'brush', erase: false, points: [0, 0, 10, 0, 20, 5], radius: 8 }]);
    expect(ops.a).toMatchObject({ id: 'a', kind: 'fog', timestamp: 0, isErasing: false, type: 'brush', brushRadius: 8, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }] });
  });

  it('keeps the order of an erasing lasso and numbers operations by index', () => {
    const ops = sharedFogOperations([
      { type: 'rectangle', erase: false, x: 0, y: 0, width: 5, height: 5 },
      { type: 'lasso', erase: true, points: [4, 3, 2, 1, 6, 5] },
    ]);
    expect(Object.keys(ops)).toEqual(['op-0', 'op-1']);
    expect(ops['op-1']).toMatchObject({ type: 'lasso', isErasing: true, timestamp: 1, points: [{ x: 4, y: 3 }, { x: 2, y: 1 }, { x: 6, y: 5 }] });
    expect(ops['op-0']).toMatchObject({ type: 'rectangle', x: 0, y: 0, width: 5, height: 5 });
  });

  it('covers where a brush paints and not inside the erasing rectangle', () => {
    const fog: SharedFog = [
      { id: 'p', type: 'brush', erase: false, points: [0, 50, 200, 50], radius: 40 },
      { id: 'e', type: 'rectangle', erase: true, x: 90, y: 30, width: 20, height: 40 },
    ];
    const coverage = fogCoverage(sharedFogOperations(fog));
    expect(coverage.covers({ x: 30, y: 50 })).toBe(true);
    expect(coverage.covers({ x: 100, y: 50 })).toBe(false);
    expect(coverage.covers({ x: 100, y: 300 })).toBe(false);
  });

  it('covers the whole map for null fog', () => {
    const coverage = fogCoverage(sharedFogOperations(null));
    expect(coverage.covers({ x: 0, y: 0 })).toBe(true);
    expect(coverage.covers({ x: 5000, y: 7000 })).toBe(true);
  });

  it('covers nothing for an empty fog', () => {
    expect(fogCoverage(sharedFogOperations([])).covers({ x: 1, y: 1 })).toBe(false);
  });
});
