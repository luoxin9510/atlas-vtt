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
import type { CheckDirection, CheckResult, CheckRule, CheckRuleInput, CheckRuleOutcome } from './checkTypes';

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
  const input: CheckRuleInput = {
    total,
    target,
    direction,
    margin,
    dice: rolls,
    defaultDice: defaultDiceOf(rolls, rules) ?? [],
    diceCrit: getDiceCrit(rolls, rules),
  };
  const outcome = registered && rules.checkRule ? runRule(rules.checkRule, registered, input) : null;
  if (outcome) return { target, direction, margin, ...outcome, rule: rules.checkRule ?? MARGIN_RULE_ID };
  return { target, direction, margin, ...marginRule(input), rule: MARGIN_RULE_ID };
}

/** Rules that failed and were logged: each is logged once, not on every roll it judges. */
const failedRules = new WeakSet<CheckRule>();

/** What a pack's rule decided, or null (logged once per rule, with its id) where it threw or answered something else than a `CheckRuleOutcome`. */
function runRule(id: string, rule: CheckRule, input: CheckRuleInput): CheckRuleOutcome | null {
  try {
    const outcome = rule(input);
    const crit: unknown = outcome?.crit;
    if (typeof outcome?.success === 'boolean' && (crit === 'success' || crit === 'failure' || crit === null)) {
      return { success: outcome.success, crit };
    }
    logFailure(rule, `[Atlas] Check rule "${id}" returned no valid outcome; the margin rule decided instead.`);
  } catch (error) {
    logFailure(rule, `[Atlas] Check rule "${id}" threw; the margin rule decided instead.`, error);
  }
  return null;
}

function logFailure(rule: CheckRule, message: string, error?: unknown): void {
  if (failedRules.has(rule)) return;
  failedRules.add(rule);
  if (error === undefined) console.error(message);
  else console.error(message, error);
}
