/** Fixed-value initiative: making the order the GM dragged among equal totals survive later sorts. */

import type { InitiativeEntry } from '../types/initiativeTypes';

/** `neighbour` when it is tied with `moved` on the total and sorts by the tie-break fields and the hidden roll. */
function tiedWith(moved: InitiativeEntry, neighbour: InitiativeEntry | undefined): InitiativeEntry | undefined {
  const ties = neighbour !== undefined && neighbour.initiative === moved.initiative
    && neighbour.tieBreakRoll !== undefined && neighbour.tieBreak === undefined;
  return ties ? neighbour : undefined;
}

function sameValues(a: InitiativeEntry, b: InitiativeEntry): boolean {
  const left = a.tieBreakValues ?? [];
  const right = b.tieBreakValues ?? [];
  return Array.from({ length: Math.max(left.length, right.length) }).every((_, index) => (left[index] ?? 0) === (right[index] ?? 0));
}

/**
 * Called once `entries[index]` was moved by hand. Where it stands among combatants with the same
 * total, it takes the tie-break numbers of the neighbour it must not outrank and a hidden roll
 * between its neighbours', so the sort that follows any later read or typed number keeps the place.
 * It is marked (`orderByHand`) so reading the statblocks keeps those numbers while its value stands.
 */
export function keepDraggedOrder(entries: InitiativeEntry[], index: number): void {
  const moved = entries[index];
  if (!moved || moved.tieBreakRoll === undefined || moved.tieBreak !== undefined) return;
  const before = tiedWith(moved, entries[index - 1]);
  const after = tiedWith(moved, entries[index + 1]);
  const base = before ?? after;
  if (!base) return;
  moved.tieBreakValues = [...(base.tieBreakValues ?? [])];
  moved.orderByHand = true;
  // Below the one before it; above the one after it where both have the same numbers
  const high = before ? before.tieBreakRoll! : 1;
  const low = after && (!before || sameValues(before, after)) ? after.tieBreakRoll! : 0;
  moved.tieBreakRoll = (low + high) / 2;
}
