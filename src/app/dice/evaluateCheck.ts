/**
 * Judging a roll against a target: the direction, the margin, then the
 * set's check rule decides success and criticals.
 */

import { rollingRules } from '../gameSystems/diceSets';
import type { DiceRules } from '../types/diceRulesTypes';
import type { RollingDice } from '../types/diceSetTypes';
import { defaultDiceOf, getDiceCrit } from '../tools/diceCrit';
import type { RolledDie } from '../tools/diceFormula';
import { MARGIN_RULE_ID, checkRule, marginRule } from './checkRules';
import type { CheckDirection, CheckResult } from './checkTypes';

/**
 * Which way a check goes: the direction written (`≤`/`≥`), else the set's `check`, else under for
 * a `roll-under` set and over for any other.
 */
export function checkDirection(rolling: DiceRules | RollingDice, written?: CheckDirection): CheckDirection {
  if (written) return written;
  const { check, crit } = rollingRules(rolling);
  return check ?? (crit === 'roll-under' ? 'under' : 'over');
}

export interface EvaluateCheckInput {
  rolling: DiceRules | RollingDice;
  rolls: readonly RolledDie[];
  total: number;
  target: number;
  /** The direction written with the check, if any. */
  written?: CheckDirection;
}

/** The result of checking `total` against `target`; an unknown rule id falls back to `builtin:margin`. */
export function evaluateCheck({ rolling, rolls, total, target, written }: EvaluateCheckInput): CheckResult {
  const rules = rollingRules(rolling);
  const direction = checkDirection(rules, written);
  const margin = direction === 'under' ? target - total : total - target;
  const registered = rules.checkRule ? checkRule(rules.checkRule) : undefined;
  const ruleId = registered && rules.checkRule ? rules.checkRule : MARGIN_RULE_ID;
  const decide = registered ?? marginRule;
  const { success, crit } = decide({
    total,
    target,
    direction,
    margin,
    dice: rolls,
    defaultDice: defaultDiceOf(rolls, rules) ?? [],
    diceCrit: getDiceCrit(rolls, rules),
  });
  return { target, direction, margin, success, crit, rule: ruleId };
}
