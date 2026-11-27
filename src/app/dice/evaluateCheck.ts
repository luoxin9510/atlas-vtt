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
import type { CheckDirection, CheckResult, CheckRuleInput, CheckRuleOutcome, TargetStep } from './checkTypes';
import { runPackRule } from './runPackRule';

/** A rule's answer where it says whether the check succeeded and whether it is critical. */
function acceptOutcome(outcome: unknown): CheckRuleOutcome | null {
  const { success, crit } = (outcome ?? {}) as { success?: unknown; crit?: unknown };
  return typeof success === 'boolean' && (crit === 'success' || crit === 'failure' || crit === null) ? { success, crit } : null;
}

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
  /** What moved `target` from where the check was written; the result records them with the target they started from. */
  steps?: readonly TargetStep[] | undefined;
}

/** The result of checking `total` against `target`; an unknown rule id falls back to `builtin:margin`. */
export function evaluateCheck({ rolling, rolls, total, target, written, steps }: EvaluateCheckInput): CheckResult {
  const rules = rollingRules(rolling);
  const direction = checkDirection(rules, written);
  const margin = direction === 'under' ? target - total : total - target;
  const registered = rules.checkRule ? checkRule(rules.checkRule) : undefined;
  const input: CheckRuleInput = {
    total,
    target,
    direction,
    margin,
    dice: rolls,
    defaultDice: defaultDiceOf(rolls, rules) ?? [],
    diceCrit: getDiceCrit(rolls, rules),
  };
  const outcome = registered && rules.checkRule ? runPackRule('Check', rules.checkRule, registered, input, acceptOutcome) : null;
  const targetBuild = steps && steps.length > 0
    ? { baseTarget: steps.reduce((base, step) => base - step.value, target), targetSteps: steps.map(({ label, value }) => ({ ...(label !== undefined && { label }), value })) }
    : {};
  if (outcome) return { target, direction, margin, ...outcome, rule: rules.checkRule ?? MARGIN_RULE_ID, ...targetBuild };
  return { target, direction, margin, ...marginRule(input), rule: MARGIN_RULE_ID, ...targetBuild };
}
