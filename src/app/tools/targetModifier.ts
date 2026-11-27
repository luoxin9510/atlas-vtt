/**
 * Where a modifier Atlas adds to a roll goes (armed statblock bonuses, a one-off modifier): on the
 * dice, or, for a check that goes under, on its target. A formula someone typed is rolled as written;
 * only what Atlas adds passes through here. Pure.
 */

import { checkDirection } from '../dice/evaluateCheck';
import { rollParseOptionsOf, rollingRules } from '../gameSystems/diceSets';
import type { DiceRules } from '../types/diceRulesTypes';
import type { RollingDice } from '../types/diceSetTypes';
import { checkText, specOfText } from './buildRoll';

/** A whole number as a formula term: `+2`, `-1`. */
export function signedTerm(value: number): string {
  return value < 0 ? `${value}` : `+${value}`;
}

/**
 * `text` with a constant `modifier` applied. A check that goes under (written `≤`, else the set's
 * direction) takes it in its target (`3d6 vs 15` +2 is `3d6 vs 17`), since a higher target is the
 * easier roll there; any other text takes `diceTerm` (default the signed modifier, `+2`) after its
 * formula, before a check's target (`1d20+2 vs 15`). Only constants move a target: dice terms,
 * which the formula holds, stay in it. `rules` give the direction and how a bare die is read.
 */
export function withTargetModifier(
  text: string, modifier: number, rules: DiceRules | RollingDice | undefined, diceTerm: string = signedTerm(modifier),
): string {
  const { formula, check } = specOfText(text, rules ? rollParseOptionsOf(rules) : {});
  if (!check) return text + diceTerm;
  const direction = rules ? checkDirection(rollingRules(rules), check.written) : (check.written ?? 'over');
  return direction === 'under' ? checkText(formula, check.target + modifier, check.written) : checkText(formula + diceTerm, check.target, check.written);
}

/** A whole number typed as `-2`, `+3` or `3` (spaces around it allowed); null for anything else. */
export function parseModifier(text: string): number | null {
  const trimmed = text.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}
