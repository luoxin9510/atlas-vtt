/**
 * Target-number checks: a roll judged against a whole-number target. The
 * types are shared by parsing, rules and results.
 */

import type { DiceCrit } from '../tools/diceCrit';
import type { RolledDie } from '../tools/diceFormula';

/** `under`: succeed on a total at most the target; `over`: at least the target. */
export type CheckDirection = 'under' | 'over';

export interface CheckResult {
  target: number;
  direction: CheckDirection;
  /** Signed: >= 0 succeeded by that much, < 0 failed by that much. under: target - total; over: total - target. */
  margin: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** The rule that decided it (a built-in id or a registered one). */
  rule: string;
}

export interface CheckRuleInput {
  total: number;
  target: number;
  direction: CheckDirection;
  margin: number;
  dice: readonly RolledDie[];
  /** The dice the set's critical rule looks at (`defaultDiceOf`); empty when the roll has none. */
  defaultDice: readonly RolledDie[];
  diceCrit: DiceCrit;
}

/** What a check rule decides: whether the check succeeded and any critical result. */
export interface CheckRuleOutcome {
  success: boolean;
  crit: 'success' | 'failure' | null;
}

export type CheckRule = (input: CheckRuleInput) => CheckRuleOutcome;
