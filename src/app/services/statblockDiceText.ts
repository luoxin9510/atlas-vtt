/**
 * Where statblock text holds dice notation and bare bonuses, and the formula
 * each rolls, as the card's roll links (`statblockDiceLinks.ts`) and a
 * player's sheet read them. The rule is `tools/textRolls.ts`.
 */

import { statblockRollPieces } from '../tools/textRolls';
import type { RollParseOptions } from '../tools/formulaTypes';

export { toRollFormula } from '../tools/textRolls';

/**
 * Splits text into plain and dice segments: what renderers build their own nodes from, and what the card links.
 * `options.defaultFaces`: the faces of a die written without them (`2d`), where the statblock's set opts in.
 */
export function splitDiceSegments(text: string, options: RollParseOptions = {}): Array<{ text: string; dice: boolean }> {
  return statblockRollPieces(text, options).map((piece) => ({ text: piece.text, dice: piece.formula !== null }));
}
