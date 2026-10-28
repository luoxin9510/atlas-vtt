import { Transform } from 'node:stream';
import { MAX_ASSET_BYTES, PART_BYTES } from '../../../../src/app/online/protocol/asset.ts';
import { sniffImage, SNIFF_BYTES } from './sniff.ts';

export type StoreFailure = 400 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 507;

/** Why a part or an image is refused; the store maps it to an HTTP status. */
export class StoreError extends Error {
  readonly status: StoreFailure;

  constructor(status: StoreFailure) {
    super(`asset store: ${status}`);
    this.status = status;
  }
}

/**
 * Counts a part while it streams: over 8 MiB or 64 MiB in all is 413, a first part that is no image
 * 415. `charge` books each accepted chunk and throws a `StoreError(507)` over a storage cap.
 */
export function partGuard(first: boolean, others: number, charge: (bytes: number) => void): Transform {
  let written = 0;
  let head = Buffer.alloc(0);
  let sniffed = false;
  let over = false;
  const check = (): void => {
    if (sniffImage(head) === null) throw new StoreError(415);
    sniffed = true;
  };
  return new Transform({
    transform: (chunk: Buffer, _encoding, done) => {
      try {
        written += chunk.length;
        // Too much: read on and drop the rest (up to twice a part) so the 413 reaches the client before the connection ends.
        if (written > 2 * PART_BYTES) throw new StoreError(413);
        if (over || written > PART_BYTES || others + written > MAX_ASSET_BYTES) {
          over = true;
          return done();
        }
        charge(chunk.length);
        if (first && !sniffed) {
          head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES);
          if (head.length >= SNIFF_BYTES) check();
        }
        done(null, chunk);
      } catch (error) {
        done(error as Error);
      }
    },
    flush: (done) => {
      try {
        if (over) throw new StoreError(413);
        if (first && !sniffed) check();
        done();
      } catch (error) {
        done(error as Error);
      }
    },
  });
}
