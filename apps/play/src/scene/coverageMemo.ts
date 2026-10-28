import { fogCoverage } from '../../../../src/app/fog/fogCoverage.ts';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import { sharedFogOperations } from './fogAdapter.ts';

/** The fog's coverage, kept while the fog is the same object; null when it cannot be worked out (nothing is hit). */
export class CoverageMemo {
  private last: { fog: SharedFog; value: ReturnType<typeof fogCoverage> } | null = null;

  of(fog: SharedFog): ReturnType<typeof fogCoverage> | null {
    if (this.last?.fog !== fog) {
      try {
        this.last = { fog, value: fogCoverage(sharedFogOperations(fog)) };
      } catch {
        return null;
      }
    }
    return this.last.value;
  }
}
