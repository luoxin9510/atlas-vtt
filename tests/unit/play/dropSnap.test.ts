import { describe, expect, it } from 'vitest';
import { axialToPixel, createHexLayout } from '../../../src/app/grid/hexGeometry.ts';
import type { SnapGrid } from '../../../src/app/online/protocol/moves.ts';
import type { SharedToken } from '../../../src/app/online/protocol/tokens.ts';
import { snapDrop } from '../../../apps/play/src/scene/dropSnap.ts';

const token = (cells: number): SharedToken => ({ id: 't1', x: 0, y: 0, size: 60, cells, rotation: 0, art: null, name: 'T', ring: null }) as SharedToken;
const square: SnapGrid = { type: 'square', size: 70, offsetX: 0, offsetY: 0 };

describe('snapDrop', () => {
  it('returns the point when the table does not snap', () => {
    expect(snapDrop({ x: 123.4, y: 56.7 }, token(1), null)).toEqual({ x: 123.4, y: 56.7 });
  });

  it('snaps a one-cell token to the centre of its square cell', () => {
    expect(snapDrop({ x: 100, y: 100 }, token(1), square)).toEqual({ x: 105, y: 105 });
    expect(snapDrop({ x: 139, y: 71 }, token(1), square)).toEqual({ x: 105, y: 105 });
  });

  it('respects the grid offset', () => {
    expect(snapDrop({ x: 100, y: 100 }, token(1), { ...square, offsetX: 10, offsetY: 20 })).toEqual({ x: 115, y: 125 });
  });

  it('snaps a token with an even footprint (1.5 cells is 2 across) to a cell corner', () => {
    expect(snapDrop({ x: 130, y: 150 }, token(1.5), square)).toEqual({ x: 140, y: 140 });
  });

  it.each(['hex-horizontal', 'hex-vertical'] as const)('snaps a one-cell token to the nearest hex centre on %s', (type) => {
    const grid: SnapGrid = { type, size: 70, offsetX: 5, offsetY: 9 };
    const centre = axialToPixel(createHexLayout(type, 70, 5, 9), { q: 2, r: 1 });
    expect(snapDrop({ x: centre.x + 6, y: centre.y - 5 }, token(1), grid)).toEqual(centre);
  });
});
