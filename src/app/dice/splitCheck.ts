/**
 * Cutting check text (`3d6 vs 14`, `1d20+5 ≥ 15`) at its separator and target, with nothing
 * parsed: the part the shared display code (`formulaWithNamedTerms`) and the parser both need.
 */

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
  /** The text from the separator on (` vs 14`), as written. */
  tail: string;
}

/** Cuts text at its trailing separator and target; null where it ends in none. The formula part is not parsed. */
export function splitCheckText(text: string): CheckSplit | null {
  const match = CHECK_END.exec(text);
  if (!match) return null;
  const mark = match[1] as CheckSplit['mark'];
  return { formula: text.slice(0, match.index).trim(), mark, target: Number(match[2]), tail: text.slice(match.index) };
}
