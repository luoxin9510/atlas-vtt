import { isRecord } from './shape.ts';
import { parseTargetSteps, type SharedTargetStep } from './targetSteps.ts';

/** The largest total Atlas's grammar lets a formula make. */
export const MAX_TOTAL = 1_000_000_000;
/** The widest margin a check holds: a target and a total, each within `MAX_TOTAL`, are that far apart at most. */
const MAX_MARGIN = 2 * MAX_TOTAL;

export const isInteger = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
export const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/**
 * The verdict of a roll judged against a target (`3d6 vs 14`), as Atlas decided it. `margin` is signed:
 * 0 or more succeeded by that much, below 0 failed by that much; `rule` names the check rule that ran.
 * Added later: an older GM sends none, and an older page shows the total without the line.
 */
export interface SharedCheck {
  readonly target: number;
  readonly direction: 'under' | 'over';
  readonly margin: number;
  readonly success: boolean;
  readonly crit: 'success' | 'failure' | null;
  readonly rule: string;
  /** Where the target stood before `targetSteps` moved it; set only with them (a check whose target was moved by modifiers). */
  readonly baseTarget?: number;
  /** What moved the target, in the order applied, each named or not; they add up from `baseTarget` to `target`. */
  readonly targetSteps?: SharedTargetStep[];
}

/** The longest rule id a shared check names. */
const MAX_CHECK_RULE = 64;


/**
 * What marks a shared roll as one side of a contest (two checks rolled against each other): `id` is
 * shared by the two rolls, and the verdict, `winner` the side that won or null for a tie, is on the
 * second. The sides' names never travel: players see "First side" / "Second side". Added later: an
 * older GM sends none and an older page shows two ordinary rolls.
 */
export interface SharedContest {
  readonly id: string;
  readonly side: 'first' | 'second';
  readonly verdict?: { readonly winner: 'first' | 'second' | null; readonly rule: string };
}

/** The longest contest id a shared roll carries. */
const MAX_CONTEST_ID = 64;

/** A roll's check as a page reads it, or null for anything malformed or unknown. */
export function parseCheck(value: unknown): SharedCheck | null {
  if (!isRecord(value)) return null;
  const { target, direction, margin, success, crit, rule } = value;
  if (!isInteger(target, -MAX_TOTAL, MAX_TOTAL) || !isInteger(margin, -MAX_MARGIN, MAX_MARGIN)) return null;
  if (direction !== 'under' && direction !== 'over') return null;
  if (typeof success !== 'boolean' || (crit !== 'success' && crit !== 'failure' && crit !== null)) return null;
  if (!isText(rule, MAX_CHECK_RULE) || rule === '') return null;
  // How a moved target was built is an extra: where it is unreadable, the check stays without it
  const moved = parseTargetSteps(value.baseTarget, value.targetSteps, target, MAX_TOTAL);
  return { target, direction, margin, success, crit, rule, ...moved };
}

/** A roll's contest as a page reads it, or null for anything malformed; the verdict is on the second side only. */
export function parseContest(value: unknown): SharedContest | null {
  if (!isRecord(value)) return null;
  const { id, side, verdict } = value;
  if (!isText(id, MAX_CONTEST_ID) || id === '' || (side !== 'first' && side !== 'second')) return null;
  if (verdict === undefined) return { id, side };
  if (side !== 'second' || !isRecord(verdict)) return null;
  const { winner, rule } = verdict;
  if ((winner !== 'first' && winner !== 'second' && winner !== null) || !isText(rule, MAX_CHECK_RULE) || rule === '') return null;
  return { id, side, verdict: { winner, rule } };
}
