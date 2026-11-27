/**
 * The pieces of rolling a contest that need no dice tool: reading one side as a roll spec, and
 * marking two rolled results as the two sides of one contest.
 */

import { splitCheckText } from '../dice/splitCheck';
import { isBareTarget } from '../dice/parseContest';
import { evaluateContest } from '../dice/evaluateContest';
import type { ContestSide, RollContest } from '../dice/contestTypes';
import type { DiceRollResult } from '../types/diceTypes';
import type { DiceRules } from '../types/diceRulesTypes';
import type { RollingDice } from '../types/diceSetTypes';
import type { RollSpec } from './buildRoll';

/** Who the two sides of a contest are, where known. */
export interface ContestNames {
  first?: string | undefined;
  second?: string | undefined;
}

/**
 * One side of a contest as a roll spec: a check as written, or a bare target (`12`) as a check of
 * the set's default roll (an empty formula). Null where the text is neither. A check whose formula
 * is no formula is still a spec, so that rolling it reports the error.
 */
export function contestSideSpec(text: string): RollSpec | null {
  const side = text.trim();
  if (isBareTarget(side)) return { formula: '', check: { target: Number(side) } };
  const split = splitCheckText(side);
  if (!split) return null;
  return { formula: split.formula, check: { target: split.target, ...(split.mark && { written: split.mark === '≤' ? 'under' as const : 'over' as const }) } };
}

/** The `contest` field of one side. */
function contestOf(id: string, side: ContestSide, names: ContestNames | undefined): RollContest {
  const given = { ...(names?.first && { first: names.first }), ...(names?.second && { second: names.second }) };
  return { id, side, ...(Object.keys(given).length > 0 && { names: given }) };
}

/**
 * Marks two rolled checks as the sides of one contest `id`, and puts the verdict by `rules` on the
 * second. Both must be checks.
 */
export function markContest(first: DiceRollResult, second: DiceRollResult, id: string, rules: DiceRules | RollingDice, names?: ContestNames): void {
  first.contest = contestOf(id, 'first', names);
  second.contest = contestOf(id, 'second', names);
  if (first.check && second.check) second.contest.verdict = evaluateContest(first.check, second.check, rules);
}
