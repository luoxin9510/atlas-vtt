/**
 * Splitting check text, `3d6 vs 14` or `1d20+5 ≥ 15`, into a formula and a
 * target before the formula parser sees it. A pure split: `parseFormula` is
 * unchanged, and ASCII `<=` / `>=` stay tallies there.
 */

import { FORMULA_LIMITS } from '../tools/formulaTypes';
import { parseFormula } from '../tools/parseFormula';
import type { CheckDirection } from './checkTypes';
import { splitCheckText } from './splitCheck';
import type { RollParseOptions } from '../tools/formulaTypes';

export interface ParsedCheck {
  formula: string;
  target: number;
  /** Set when written with `≤` or `≥`; unset for `vs`. */
  direction?: CheckDirection;
}

/**
 * Check text split into formula and target; null when it is not one (or its formula does not parse,
 * dice written without faces having `options.defaultFaces`).
 */
export function parseCheck(text: string, options: RollParseOptions = {}): ParsedCheck | null {
  if (text.length > FORMULA_LIMITS.characters) return null;
  const split = splitCheckText(text);
  if (!split) return null;
  const { formula, mark, target } = split;
  if (!formula || !parseFormula(formula, undefined, options).ok) return null;
  const direction: CheckDirection | undefined = mark === undefined ? undefined : mark === '≤' ? 'under' : 'over';
  return { formula, target, ...(direction && { direction }) };
}
