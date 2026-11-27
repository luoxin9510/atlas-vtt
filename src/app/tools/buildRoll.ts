import { evaluateCheck } from '../dice/evaluateCheck';
import { parseCheck } from '../dice/parseCheck';
import type { CheckDirection } from '../dice/checkTypes';
import { rollingRules } from '../gameSystems/diceSets';
import type { DiceRollResult } from '../types/diceTypes';
import type { DiceRules } from '../types/diceRulesTypes';
import type { AdvantageSide, RollingDice } from '../types/diceSetTypes';
import { completeFormula } from './completeFormula';
import { withAdvantage } from './diceAdvantage';
import { getDiceCrit } from './diceCrit';
import { dressSetDice } from './diceAppearance';
import { rollFormula } from './diceFormula';
import type { FormulaError } from './parseFormula';

/** What a roll is: a formula and, for a check, its target and the direction written with it. */
export interface RollSpec {
  formula: string;
  check?: { target: number; written?: CheckDirection };
}

/** The fields of a roll that the dice decide: everything but who rolled, when, and the set shown. */
export type RollBody = Omit<DiceRollResult, 'id' | 'timestamp' | 'player' | 'diceSet' | 'source'>;

/** Check text (`3d6 vs 10`, `1d20+5 ≥ 15`) as a spec; any other text is a plain formula, unchanged. */
export function specOfText(text: string): RollSpec {
  const parsed = parseCheck(text);
  if (!parsed) return { formula: text };
  return { formula: parsed.formula, check: { target: parsed.target, ...(parsed.direction && { written: parsed.direction }) } };
}

/** A check written out: `3d6 vs 10`, or with `≤`/`≥` where a direction was written. */
export function checkText(formula: string, target: number, written?: CheckDirection): string {
  return `${formula} ${written === 'under' ? '≤' : written === 'over' ? '≥' : 'vs'} ${target}`;
}

/**
 * Rolls `spec` by `rules`: the one pipeline behind the dice tool's rolls and quiet rolls. A formula without
 * dice is completed with the set's dice, `advantage` changes a roll of the set's dice as its rule says, and
 * a check is judged by the rules in use. The error that refuses the formula (or advantage past a limit) otherwise.
 */
export function buildRoll(
  spec: RollSpec, rules: DiceRules | RollingDice, random: () => number, advantage?: AdvantageSide, setAppearance = false,
): RollBody | FormulaError {
  const rolling = rollingRules(rules);
  const complete = completeFormula(spec.formula, rules);
  if (!complete.ok) return complete;
  const looks = complete.written ? [] : rolling.dice;
  const helped = advantage ? withAdvantage(complete.parsed, looks, rolling, advantage) : null;
  if (helped && 'ok' in helped) return helped;
  const { rolls, modifiers, named, total, linear } = helped
    ? rollFormula(helped.formula, random, helped.explodeRules, helped.looks)
    : rollFormula(complete.parsed, random, rolling, looks);
  const { check } = spec;
  return {
    formula: check ? checkText(complete.formula, check.target, check.written) : complete.formula,
    rolls: complete.written && setAppearance ? dressSetDice(rolls, rolling) : rolls,
    modifiers,
    ...(named.length > 0 && { namedModifiers: named }),
    total,
    ...(!linear && { linear: false as const }),
    crit: getDiceCrit(rolls, rolling),
    ...(check && { check: evaluateCheck({ rolling, rolls, total, target: check.target, ...(check.written && { written: check.written }) }) }),
    ...(helped && advantage && { advantage }),
  };
}
