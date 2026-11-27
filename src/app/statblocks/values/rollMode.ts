import type { Rollable, RollMode } from '../model/templateTypes';

/** The way a block rolls its numbers (`rollAs`, else `rollable`), undefined where it rolls none. */
export function rollModeOf(block: Rollable): RollMode | undefined {
  if (block.rollAs === 'check') return 'check';
  return block.rollable === true ? 'bonus' : undefined;
}
