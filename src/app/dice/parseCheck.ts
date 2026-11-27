/**
 * Splitting check text, `3d6 vs 14` or `1d20+5 ≥ 15`, into a formula and a
 * target before the formula parser sees it. A pure split: `parseFormula` is
 * unchanged, and ASCII `<=` / `>=` stay tallies there.
 */

import { FORMULA_LIMITS } from '../tools/formulaTypes';
import { parseFormula } from '../tools/parseFormula';
import type { CheckDirection } from './checkTypes';

export interface ParsedCheck {
  formula: string;
  target: number;
  /** Set when written with `≤` or `≥`; unset for `vs`. */
  direction?: CheckDirection;
}

/**
 * A separator and a signed target of 1-9 digits at the end of the text: `vs` between spaces, or
 * `≤` / `≥`. Unanchored at the start, the leftmost match whose target runs to the end is the last
 * separator, since a target holds no separator.
 */
const CHECK_END = /(?:\s+vs\s+|\s*([≤≥])\s*)([+-]?\d{1,9})\s*$/i;

/** Check text split into formula and target; null when it is not one (or its formula does not parse). */
export function parseCheck(text: string): ParsedCheck | null {
  if (text.length > FORMULA_LIMITS.characters) return null;
  const match = CHECK_END.exec(text);
  if (!match) return null;
  const formula = text.slice(0, match.index).trim();
  if (!formula || !parseFormula(formula).ok) return null;
  const mark = match[1];
  const direction: CheckDirection | undefined = mark === undefined ? undefined : mark === '≤' ? 'under' : 'over';
  return { formula, target: Number(match[2]), ...(direction && { direction }) };
}
