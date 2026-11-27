/**
 * Judging a contest: the set's contest rule decides which of two checks won, the
 * built-in rule where it names none, none is registered or it fails.
 */

import { rollingRules } from '../gameSystems/diceSets';
import type { DiceRules } from '../types/diceRulesTypes';
import type { RollingDice } from '../types/diceSetTypes';
import type { CheckResult } from './checkTypes';
import { CONTEST_MARGIN_RULE_ID, contestMarginRule, contestRule } from './contestRules';
import type { ContestRuleInput, ContestRuleOutcome, ContestVerdict } from './contestTypes';
import { runPackRule } from './runPackRule';

/** A rule's answer where it names a winner (or a tie). */
function acceptOutcome(outcome: unknown): ContestRuleOutcome | null {
  const winner: unknown = (outcome as ContestRuleOutcome | undefined)?.winner;
  return winner === 'first' || winner === 'second' || winner === null ? { winner } : null;
}

/** Who won between two judged checks by the rules in use; an unknown rule id falls back to `builtin:contest-margin`. */
export function evaluateContest(first: CheckResult, second: CheckResult, rolling: DiceRules | RollingDice): ContestVerdict {
  const id = rollingRules(rolling).contestRule;
  // A rule works on copies: whatever it changes, the recorded results stay as rolled.
  const input: ContestRuleInput = { first: structuredClone(first), second: structuredClone(second) };
  const registered = id ? contestRule(id) : undefined;
  const outcome = id && registered ? runPackRule('Contest', id, registered, input, acceptOutcome) : null;
  if (outcome && id) return { winner: outcome.winner, rule: id };
  return { ...contestMarginRule(input), rule: CONTEST_MARGIN_RULE_ID };
}
