/** Writing the numbers read from statblocks onto the combatants of a fight with fixed-value initiative. */

import type { InitiativeEntry } from '../types/initiativeTypes';
import { setInitiative } from './awaitingInitiative';

/** What a statblock holds for a combatant: its value (null where it has none) and its tie-break numbers. */
export interface FixedRead {
  value: number | null;
  /** In the rules' tie-break order; a field the statblock lacks reads 0. */
  tieBreaks: number[];
}

/**
 * Writes `read` onto `entry`. The tie-break numbers are refreshed (unless the GM dragged it, `orderByHand`, and its value stands), and the hidden roll is
 * drawn (`random`) only the first time, so a later read never changes it. The value becomes the
 * combatant's initiative unless the GM typed one (`fixedByHand`) or the statblock holds none, in
 * which case the number the combatant has, or its wait, stands. No modifier is ever added.
 */
export function applyFixedRead(entry: InitiativeEntry, read: FixedRead, random: () => number): void {
  // A value that changed makes the GM's drag moot
  if (entry.orderByHand && !entry.fixedByHand && read.value !== null && read.value !== entry.initiative) delete entry.orderByHand;
  if (!entry.orderByHand) entry.tieBreakValues = read.tieBreaks;
  entry.tieBreakRoll ??= random();
  if (entry.fixedByHand || read.value === null) return;
  setInitiative(entry, read.value);
  delete entry.rolledModifier;
  delete entry.tieBreak;
}
