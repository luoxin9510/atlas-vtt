/**
 * Cutting check text (`3d6 vs 14`, `1d20+5 ≥ 15`) at its separator and target, with nothing
 * parsed: the part the shared display code (`formulaWithNamedTerms`) and the parser both need.
 */

/** The most digits a check target has. */
export const CHECK_TARGET_DIGITS = 9;

/** Pattern source for a signed target of 1-9 digits. */
export const CHECK_TARGET_SOURCE = `[+-]?\\d{1,${CHECK_TARGET_DIGITS}}`;

/**
 * Pattern source for a check separator: `vs` between `space`s, or `≤` / `≥` (captured as the mark).
 * `space` is the whitespace class the caller allows: `\\s` in a whole text, `[ \\t]` in running text.
 */
export function checkSeparatorSource(space: string): string {
  return `(?:${space}+vs${space}+|${space}*([≤≥])${space}*)`;
}

/**
 * A separator and a signed target at the end of the text. Unanchored at the start, the leftmost
 * match whose target runs to the end is the last separator, since a target holds no separator.
 */
const CHECK_END = new RegExp(`${checkSeparatorSource('\\s')}(${CHECK_TARGET_SOURCE})\\s*$`, 'i');

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
