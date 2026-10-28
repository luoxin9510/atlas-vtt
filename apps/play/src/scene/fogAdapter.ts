import type { SharedFog, SharedFogOperation } from '../../../../src/app/online/protocol/fog.ts';
import { MAX_FOG_COORDINATE } from '../../../../src/app/online/protocol/fog.ts';
import type { FogOperation } from '../../../../src/app/types/fogTypes.ts';

type Operations = Readonly<Record<string, FogOperation>>;

function pairs(flat: readonly number[]): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i]!, y: flat[i + 1]! });
  return points;
}

function atlasOperation(operation: SharedFogOperation, index: number): FogOperation {
  const base = { id: operation.id ?? `op-${index}`, kind: 'fog' as const, timestamp: index, isErasing: operation.erase };
  if (operation.type === 'rectangle') {
    return { ...base, type: 'rectangle', x: operation.x, y: operation.y, width: operation.width, height: operation.height };
  }
  const points = pairs(operation.points);
  return operation.type === 'brush' ? { ...base, type: 'brush', points, brushRadius: operation.radius } : { ...base, type: 'lasso', points };
}

/**
 * The inverse of the GM's `sharedFog`: Atlas fog operations in replay order (their timestamp is
 * their index). The GM already applied each drag offset, so none is set here. `null` fog (the
 * GM's fog could not be read) is one rectangle over everything the protocol can name: the whole
 * map is covered.
 */
export function sharedFogOperations(fog: SharedFog): Operations {
  if (fog === null) {
    const whole = { type: 'rectangle', erase: false, x: -MAX_FOG_COORDINATE, y: -MAX_FOG_COORDINATE, width: 2 * MAX_FOG_COORDINATE, height: 2 * MAX_FOG_COORDINATE } as const;
    return { cover: atlasOperation({ id: 'cover', ...whole }, 0) };
  }
  const operations: Record<string, FogOperation> = {};
  fog.forEach((operation, index) => {
    const converted = atlasOperation(operation, index);
    operations[converted.id] = converted;
  });
  return operations;
}
