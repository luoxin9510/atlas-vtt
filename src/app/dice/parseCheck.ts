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

/** Check text cut at its last separator, before any parsing: the formula as written, the mark (`≤`/`≥`, none for `vs`) and the target. */
export interface CheckSplit {
  formula: string;
  mark: '≤' | '≥' | undefined;
  target: number;
}

/** Cuts text at its trailing separator and target; null where it ends in none. The formula part is not parsed. */
export function splitCheckText(text: string): CheckSplit | null {
  const match = CHECK_END.exec(text);
  if (!match) return null;
  const mark = match[1] as CheckSplit['mark'];
  return { formula: text.slice(0, match.index).trim(), mark, target: Number(match[2]) };
}

/**
 * Check text split into formula and target; null when it is not one (or its formula does not parse,
 * dice written without faces having `defaultFaces`).
 */
export function parseCheck(text: string, defaultFaces?: number): ParsedCheck | null {
  if (text.length > FORMULA_LIMITS.characters) return null;
  const split = splitCheckText(text);
  if (!split) return null;
  const { formula, mark, target } = split;
  if (!formula || !parseFormula(formula, undefined, defaultFaces).ok) return null;
  const direction: CheckDirection | undefined = mark === undefined ? undefined : mark === '≤' ? 'under' : 'over';
  return { formula, target, ...(direction && { direction }) };
}
