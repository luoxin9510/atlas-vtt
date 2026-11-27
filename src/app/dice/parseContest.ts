/**
 * Contest text, `12 对 14` or `3d6 vs 12 against 3d6 vs 14`: two sides cut at one separator.
 * A pure split: each side is check text, or a bare target (`12`) that the roll path completes
 * with the set's default roll.
 */

import type { RollParseOptions } from '../tools/formulaTypes';
import { CHECK_TARGET_DIGITS } from './splitCheck';
import { parseCheck } from './parseCheck';

/** The two sides of a contest as written, trimmed. */
export interface ParsedContest {
  first: string;
  second: string;
}

/** The separator: `对` with or without spaces, or `against` between spaces in any case. */
const SEPARATOR = /\s*对\s*|\s+against\s+/gi;

const BARE_TARGET = new RegExp(`^\\d{1,${CHECK_TARGET_DIGITS}}$`);

/** Whether a side is a bare target: unsigned digits, the set's default roll against that number. */
export function isBareTarget(side: string): boolean {
  return BARE_TARGET.test(side);
}

/** Whether a side is one a contest can roll: a bare target or a check. */
function isSide(side: string, options: RollParseOptions): boolean {
  return isBareTarget(side) || parseCheck(side, options) !== null;
}

/**
 * Contest text cut at its one separator; null when it has none or several, or a side is neither
 * a check nor a bare target. `12 vs 14` is a check, not a contest.
 */
export function parseContest(text: string, options: RollParseOptions = {}): ParsedContest | null {
  const separators = [...text.matchAll(SEPARATOR)];
  if (separators.length !== 1) return null;
  const [match] = separators;
  const first = text.slice(0, match!.index).trim();
  const second = text.slice(match!.index + match![0].length).trim();
  return isSide(first, options) && isSide(second, options) ? { first, second } : null;
}
