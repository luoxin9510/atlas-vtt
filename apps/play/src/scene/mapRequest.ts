import type { AssetRef } from '../../../../src/app/online/protocol/index.ts';
import type { TableState } from '../state/tableStore.ts';

export const LOW_POWER_MAP_SIDE = 4096;
export const MAX_MAP_SIDE = 8192;
const MIN_MAP_SIDE = 256;

/**
 * The map image this table state wants, or null. A lit scene (or any scene that does not say
 * `lit: false`) wants none: its map is never requested (fail closed).
 */
export function mapRequest(
  state: Pick<TableState, 'mode' | 'scene'>,
  lowPower: boolean,
  maxTexture: number,
): { ref: AssetRef; maxSide: number } | null {
  const { scene } = state;
  if (state.mode !== 'map' || scene === null || scene.lit !== false || scene.map === null) return null;
  const side = lowPower ? LOW_POWER_MAP_SIDE : Math.min(MAX_MAP_SIDE, maxTexture);
  return { ref: scene.map, maxSide: Math.max(MIN_MAP_SIDE, Math.floor(side)) };
}
