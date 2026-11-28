/**
 * The order of a fight in turn order: the higher total first, of equal totals the higher
 * tie-break, and of equal tie-breaks the order the combatants had, which the GM settles by dragging.
 */

import type { InitiativeEntry } from '../types/initiativeTypes';
import { ownModifier } from './initiativeModifier';

/**
 * What breaks a tie: where Act Now placed the combatant, the tie-break of the one it acted before
 * (`tieBreak`, so the stable sort keeps it right before that one); else the GM's own modifier,
 * else what the last roll added, else nothing.
 */
export function tieBreakModifier(entry: InitiativeEntry): number {
  return entry.tieBreak ?? ownModifier(entry) ?? entry.rolledModifier ?? 0;
}

/**
 * Fixed-value initiative: of equal totals, the tie-break fields in the rules' order, the higher
 * first, then the hidden roll drawn when the combatant joined. Nothing where either lacks them
 * (a roll's ties keep their order), or where Act Now placed one of them (its place stands).
 */
function byFixedTieBreak(a: InitiativeEntry, b: InitiativeEntry): number {
  if (a.tieBreak !== undefined || b.tieBreak !== undefined) return 0;
  const left = a.tieBreakValues ?? [];
  const right = b.tieBreakValues ?? [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return (b.tieBreakRoll ?? 0) - (a.tieBreakRoll ?? 0);
}

/** Compares two combatants by total, then tie-break; 0 keeps their order (the sort is stable). */
export function byInitiative(a: InitiativeEntry, b: InitiativeEntry): number {
  return b.initiative - a.initiative || tieBreakModifier(b) - tieBreakModifier(a) || byFixedTieBreak(a, b);
}
