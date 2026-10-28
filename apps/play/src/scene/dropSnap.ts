import { snapTokenCenter } from '../../../../src/app/grid/gridPlacement.ts';
import { createHexLayout, isHexGridType, nearestHexCenter, type Point } from '../../../../src/app/grid/hexGeometry.ts';
import type { SnapGrid } from '../../../../src/app/online/protocol/moves.ts';
import type { SharedToken } from '../../../../src/app/online/protocol/tokens.ts';

/**
 * Where a token dropped at `point` lands: the point itself when the table does not snap, else where
 * Atlas's own drop puts a token of that footprint (the GM places a player's drop as given).
 */
export function snapDrop(point: Point, token: Pick<SharedToken, 'cells'>, snap: SnapGrid | null): Point {
  if (snap === null) return point;
  const { type, size, offsetX, offsetY } = snap;
  const toCell = isHexGridType(type)
    ? (p: Point): Point => nearestHexCenter(createHexLayout(type, size, offsetX, offsetY), p)
    : (p: Point): Point => {
      const col = Math.floor((p.x - offsetX) / size);
      const row = Math.floor((p.y - offsetY) / size);
      return { x: col * size + offsetX + size / 2, y: row * size + offsetY + size / 2 };
    };
  return snapTokenCenter(point, token.cells, type, size, toCell);
}
