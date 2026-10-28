import { MAX_PARTS } from '../../../../src/app/online/protocol/index.ts';

export interface PartPiece {
  readonly id: string;
  readonly index: number;
  readonly count: number;
  readonly data: string;
}

/** A set that waits longer than this for its last piece is dropped. */
export const PART_TTL_MS = 30_000;
/** The most sets in flight; the oldest is dropped for a ninth. */
export const MAX_SETS = 8;

interface PartSet {
  readonly count: number;
  readonly since: number;
  readonly pieces: Map<number, string>;
}

function decode(pieces: readonly string[]): unknown {
  const chunks = pieces.map((data) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Puts the `part` messages of one big message back together: base64 pieces joined in index order, UTF-8 decoded, parsed as JSON. */
export class PartAssembler {
  private sets = new Map<string, PartSet>();

  constructor(private readonly now: () => number) {}

  /** The parsed JSON once the last piece of its set has come; null until then, and for a set that does not decode. */
  take(part: PartPiece): unknown | null {
    const now = this.now();
    for (const [id, set] of this.sets) if (now - set.since > PART_TTL_MS) this.sets.delete(id);
    if (!Number.isInteger(part.count) || part.count < 1 || part.count > MAX_PARTS || !Number.isInteger(part.index) || part.index < 0 || part.index >= part.count) return null;
    let set = this.sets.get(part.id);
    if (set === undefined || set.count !== part.count) {
      this.sets.delete(part.id);
      set = { count: part.count, since: now, pieces: new Map() };
      this.sets.set(part.id, set);
      if (this.sets.size > MAX_SETS) {
        const oldest = this.sets.keys().next().value;
        if (oldest !== undefined) this.sets.delete(oldest);
      }
    }
    set.pieces.set(part.index, part.data);
    if (set.pieces.size < set.count) return null;
    this.sets.delete(part.id);
    try {
      return decode(Array.from({ length: set.count }, (_, index) => set.pieces.get(index) ?? ''));
    } catch {
      return null;
    }
  }
}
