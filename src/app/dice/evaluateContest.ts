/**
 * Judging a contest: the set's contest rule decides which of two checks won, the
 * built-in rule where it names none, none is registered or it fails.
 */

import { rollingRules } from '../gameSystems/diceSets';
import type { DiceRules } from '../types/diceRulesTypes';
import type { RollingDice } from '../types/diceSetTypes';
import type { CheckResult } from './checkTypes';
import { CONTEST_MARGIN_RULE_ID, contestMarginRule, contestRule } from './contestRules';
import type { ContestRule, ContestRuleInput, ContestRuleOutcome, ContestVerdict } from './contestTypes';

/** Who won between two judged checks by the rules in use; an unknown rule id falls back to `builtin:contest-margin`. */
export function evaluateContest(first: CheckResult, second: CheckResult, rolling: DiceRules | RollingDice): ContestVerdict {
  const id = rollingRules(rolling).contestRule;
  const input: ContestRuleInput = { first, second };
  const registered = id ? contestRule(id) : undefined;
  const outcome = id && registered ? runRule(id, registered, input) : null;
  if (outcome && id) return { winner: outcome.winner, rule: id };
  return { ...contestMarginRule(input), rule: CONTEST_MARGIN_RULE_ID };
}

/** Rules that failed and were logged: each is logged once, not on every contest it judges. */
const failedRules = new WeakSet<ContestRule>();

/** What a pack's rule decided, or null (logged once per rule, with its id) where it threw or answered something else than a `ContestRuleOutcome`. */
function runRule(id: string, rule: ContestRule, input: ContestRuleInput): ContestRuleOutcome | null {
  try {
    const outcome = rule(input);
    const winner: unknown = outcome?.winner;
    if (winner === 'first' || winner === 'second' || winner === null) return { winner };
    logFailure(rule, `[Atlas] Contest rule "${id}" returned no valid outcome; the margin rule decided instead.`);
  } catch (error) {
    logFailure(rule, `[Atlas] Contest rule "${id}" threw; the margin rule decided instead.`, error);
  }
  return null;
}

function logFailure(rule: ContestRule, message: string, error?: unknown): void {
  if (failedRules.has(rule)) return;
  failedRules.add(rule);
  if (error === undefined) console.error(message);
  else console.error(message, error);
}
