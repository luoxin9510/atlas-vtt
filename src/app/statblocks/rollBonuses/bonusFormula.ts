/**
 * A statblock's roll with the values armed for it ("Add to next roll"): each
 * added after the formula as a labelled constant (`1d20+5+2[Proficiency]`),
 * which the roll keeps apart from its other constants
 * (`DiceRollResult.namedModifiers`). The formula is checked as a whole when it
 * is rolled, so a value that takes it past a limit refuses the roll. Pure.
 */

import { LABEL_CHARACTERS, LABEL_LENGTH } from '../../tools/formulaTerms';
import { labelledConstant } from '../../tools/namedModifiers';
import type { ArmableValues } from './armableValues';
import type { ArmedBonus } from './armedBonuses';
import { withTargetModifier } from '../../tools/targetModifier';
import type { DiceRules } from '../../types/diceRulesTypes';
import type { RollingDice } from '../../types/diceSetTypes';

const NOT_IN_LABEL = new RegExp(`[^${LABEL_CHARACTERS}]+`, 'gu');

/** A label as a dice formula can hold it: other characters read as spaces, and it is cut to the formula's limit. */
export function formulaLabel(label: string): string {
  return label.replace(NOT_IN_LABEL, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_LENGTH).trim();
}

/** A formula that is a bare bonus: a whole number the dice set's dice complete (`+4`, `-1`, `2`). */
const BARE_BONUS = /^[+-]?\d+$/;

/**
 * A bare bonus named by what the roll is for (`+4` rolled for Agility is `+4[Agility]`), so the roll
 * shows it as "Agility +4" rather than as its modifier; null where the formula is no bare bonus or
 * the name holds nothing a formula can write. The set's dice that complete it stay unnamed.
 */
export function namedBareBonus(formula: string, name: string | undefined): string | null {
  const label = name === undefined ? '' : formulaLabel(name);
  return label !== '' && BARE_BONUS.test(formula) ? labelledConstant({ label, value: Number(formula) }) : null;
}

/** The armed ids the card shows a value for, as the roll adds them, in the order they were armed. */
export function armedValues(ids: readonly string[], shown: ArmableValues): ArmedBonus[] {
  return ids.flatMap((id) => {
    const value = shown.get(id);
    return value ? [{ id, ...value }] : [];
  });
}

/**
 * `formula` with every armed value added. A check (`3d6 vs 14`) takes them in its formula, not after its target
 * (`1d20+2[Proficiency] vs 14`), except one that goes under (`rules`: written `≤`, else the set's direction),
 * which takes their sum in its target (`3d6 vs 16`; `withTargetModifier`) and shows no labels. Armed values are
 * always whole numbers, so all of them move; dice terms in the formula stay in it. A label that holds nothing
 * a formula can write adds the number alone. `rules` also say how a die written without faces is read.
 */
export function withArmedBonuses(formula: string, armed: readonly ArmedBonus[], rules?: DiceRules | RollingDice): string {
  if (armed.length === 0) return formula;
  const added = armed.map(({ label, value }) => labelledConstant({ label: formulaLabel(label), value })).join('');
  return withTargetModifier(formula, armed.reduce((sum, { value }) => sum + value, 0), rules, added);
}
