/** What the initiative card's edit popup reads from an entry and writes back to it. */

import type { InitiativeEntry } from '../types/initiativeTypes';
import { plainNumber } from './fixedInitiativeReading';
import { ownModifier, parseInitiativeModifier } from './initiativeModifier';

type EditedParts = Partial<Pick<InitiativeEntry, 'initiative' | 'awaitingInitiative' | 'fixedByHand' | 'initiativeModifier' | 'modifierByHand'>>;

/** The modifier field as the popup opens: the GM's own modifier, empty where there is none. */
export function modifierText(entry: Pick<InitiativeEntry, 'initiativeModifier' | 'modifierByHand'>): string {
  const own = ownModifier(entry);
  return own === undefined ? '' : String(own);
}

/**
 * The changes of a confirmed popup: the total where it reads as a whole number, and the GM's own
 * modifier, 0 included, which an emptied field clears so the statblock's counts again. What is
 * no number changes nothing. With fixed-value initiative (`fixed`) the total may have decimals and
 * counts as typed by hand, an emptied total clears it, and the modifier plays no part.
 */
export function initiativeEdit(totalText: string, modifierInput: string, fixed = false): EditedParts {
  if (fixed) return totalEdit(totalText, true);
  const modifier = modifierInput.trim() === '' ? null : parseInitiativeModifier(modifierInput);
  return {
    ...totalEdit(totalText),
    ...(modifierInput.trim() === ''
      ? { initiativeModifier: 0, modifierByHand: undefined }
      : modifier !== null && { initiativeModifier: modifier, modifierByHand: true }),
  };
}

/**
 * The change of a number typed on the card itself: the total where it reads as a whole number, else
 * nothing. With fixed-value initiative (`fixed`) decimals read too, the number is marked as typed
 * (`fixedByHand`, which the statblocks' values do not replace), and an emptied number clears it: the
 * combatant waits again and the next read of the statblocks fills it.
 */
export function totalEdit(totalText: string, fixed = false): Pick<EditedParts, 'initiative' | 'awaitingInitiative' | 'fixedByHand'> {
  if (!fixed) {
    const total = parseInitiativeModifier(totalText);
    return total === null ? {} : { initiative: total };
  }
  if (totalText.trim() === '') return { initiative: 0, awaitingInitiative: true, fixedByHand: undefined };
  const total = plainNumber(totalText);
  return total === null ? {} : { initiative: total, fixedByHand: true };
}
