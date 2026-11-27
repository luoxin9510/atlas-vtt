/**
 * What a value of a statblock rolls on a click, as the card links it. Text
 * links the rolls written in it (`tools/textRolls.ts`); a block switched to
 * "Roll as a bonus" (`rollable`) also rolls a whole number it shows as a bonus,
 * `2` as `+2`, which Atlas completes with the game's dice; one switched to "Roll as
 * a check" (`rollAs`) rolls the number as the target of the set's roll, `15` as `3d6 vs 15`.
 */

import { statblockRollPieces } from '../../tools/textRolls';
import type { RollParseOptions } from '../../tools/formulaTypes';
import type { RollMode } from '../model/templateTypes';

/**
 * How a value's text is read as rolls, and what a check rolls: `checkRoll` is the default roll of the
 * statblock's set (`3d6`), which a number rolled as a check is the target of; unset, none is.
 */
export interface ValueRollOptions extends RollParseOptions { readonly checkRoll?: string | undefined }

/** A block's way of rolling its numbers: `true` is a bonus, as a block's `rollable` is. */
export type RollSwitch = RollMode | boolean | undefined;

/** The whole number a value starts with, a target (`15`, `15 (DX+2)`); no sign, no decimals, no dice (`2d6`). */
const LEADING_NUMBER = /^\s*(\d{1,4})(?![\d.]|d)/i;

/** The check a value rolls as the target of `checkRoll`, `15 (DX+2)` as `3d6 vs 15`; null without a leading number or a set. */
function checkOf(text: string, checkRoll: string | undefined): string | null {
  const target = LEADING_NUMBER.exec(text)?.[1];
  return target === undefined || !checkRoll ? null : `${checkRoll} vs ${Number(target)}`;
}

/** A whole number as written on a card: an optional sign (minus sign and en dash included) on at most four digits. */
const WHOLE_NUMBER = /^([+\-−–]?)(\d{1,4})$/;

/** A whole number as the bonus it rolls: `2` and `+2` roll `+2`, `-1` and `−1` roll `-1`, `0` rolls `+0`; null for any other text. */
export function bonusOf(text: string): string | null {
  const match = WHOLE_NUMBER.exec(text.trim());
  if (!match) return null;
  const value = Number(match[2]);
  return match[1] !== '' && match[1] !== '+' && value !== 0 ? `-${value}` : `+${value}`;
}

/**
 * The bonus a rollable value's own link rolls, where its text links no dice of
 * its own (`2`, `–1`): a signed `+2` is linked by the text already. Null where
 * the block is not rollable or the text is no whole number. A block that rolls as a check (`mode`)
 * links the leading number of a value as the target of the set's roll (`3d6 vs 15`). `options.defaultFaces`: the faces
 * of a die written without them (`1d+1`), where the statblock's set opts in.
 */
export function bonusLink(text: string, mode: RollSwitch, options: ValueRollOptions = {}): string | null {
  if (mode === 'check') return checkOf(text, options.checkRoll);
  if (mode !== true && mode !== 'bonus') return null;
  if (statblockRollPieces(text, options).some((piece) => piece.formula !== null)) return null;
  return bonusOf(text);
}

/**
 * What a click on a whole value rolls, as the card links it: a rollable
 * value's number as a bonus, else the one roll its text holds (`1d8+3`,
 * `ATK: +4`, `+4+1`, `2 + 1d6`) where it holds exactly one and no other number.
 * Null where it rolls nothing. `options` as in `bonusLink`.
 */
export function valueRoll(text: string, mode: RollSwitch, options: ValueRollOptions = {}): string | null {
  const bonus = bonusLink(text, mode, options);
  if (bonus !== null) return bonus;
  const pieces = statblockRollPieces(text, options);
  const rolls = pieces.filter((piece) => piece.formula !== null);
  const [only] = rolls;
  if (rolls.length !== 1 || !only || pieces.some((piece) => piece.formula === null && /\d/.test(piece.text))) return null;
  return only.formula;
}
