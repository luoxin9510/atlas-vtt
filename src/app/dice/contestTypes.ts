/**
 * Contests: two checks rolled against each other. The types are shared by the rule
 * registry, the roll path and the displays.
 */

import type { CheckResult } from './checkTypes';

/** Which of the two checks: the one written first, or second. */
export type ContestSide = 'first' | 'second';

/** Who won a contest (null: a tie) and the rule that decided it. */
export interface ContestVerdict {
  winner: ContestSide | null;
  /** The rule that decided it (a built-in id or a registered one). */
  rule: string;
}

/** The two judged checks a contest rule decides between. */
export interface ContestRuleInput {
  first: CheckResult;
  second: CheckResult;
}

/** What a contest rule decides: the winner, or null for a tie. */
export interface ContestRuleOutcome {
  winner: ContestSide | null;
}

export type ContestRule = (input: ContestRuleInput) => ContestRuleOutcome;

/** What marks a roll as one side of a contest; the verdict is on the second result only. */
export interface RollContest {
  /** Shared by both rolls of the contest. */
  id: string;
  side: ContestSide;
  names?: { first?: string; second?: string };
  verdict?: ContestVerdict;
}
