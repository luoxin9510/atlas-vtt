import type { InitiativeState } from '../types/initiativeTypes';
import { byInitiative } from './tieBreak';
import { renumber } from './turnOrder';
import { sortByCards } from './cardDeal';

/**
 * Sorts the combatants into turn order (`byInitiative`; the fixed-value fields count only while
 * `fixedValues` says the rules are fixed), or by their cards in a fight by cards;
 * the turn stays with the combatant that has it.
 */
export function sortCombatants(initiative: InitiativeState): void {
  if (initiative.cards) return sortByCards(initiative);
  const fixed = initiative.fixedValues === true;
  initiative.entries.sort((a, b) => byInitiative(a, b, fixed));
  renumber(initiative.entries);
  const active = initiative.entries.findIndex((entry) => entry.isActive);
  if (active !== -1) initiative.currentIndex = active;
}
