/**
 * Where a text holds rolls, and the formula each rolls: the one rule every surface that shows
 * statblock values and texts with roll links reads (the card, the DM screen, the note panel, and the
 * online player page, which keeps a copy of this file). Pure.
 *
 * A formula is a roll where the dice parser accepts it (`parseFormula`, within its limits) and it
 * throws dice (`2d8+2`, `d20`, `3d6kh2+1`) or opens with a sign (`+2`, `+4+1`, `-1+2`): a bonus,
 * which the dice tool adds to the game's dice. A number alone (`3`) or a sum without a sign (`4+1`)
 * is no roll.
 *
 * In running text a roll opens on a die (`2d8`, `D12`, `d%`), on a sign standing directly on its
 * first die or number (`+4`, `−1`, `+2d6`), or on an attack label before such a sign (`ATK: +4`),
 * and goes on over further dice and numbers joined by `+ - − – * / ×` (and the SRD's `+ -`), with
 * spaces or tabs around them if any. A die or number never starts or ends inside a word or a
 * number ("x2d6", "hd6", "5d", "+5ft", "+1.5"), so numbers in sentences ("3 goblins", "Recharge
 * 5-6", "CR 1/4", "1 + 1") roll nothing, and a dash with a space after it is punctuation ("Very
 * Close - 1d12+2" rolls 1d12+2). Brackets are punctuation too ("(2d6 + 3)" rolls 2d6 + 3), and a
 * single `!` after dice ends a sentence rather than exploding them. What the parser refuses
 * (`101d6`, `1d0`) rolls nothing. Where that leaves a number outside every roll, the whole text is
 * read as one formula instead, so a value such as `2 + 1d6` or `(1d8+2)*2` rolls whole.
 *
 * A roll joined to a `@` reference by operators, brackets and spaces alone (`2d6 + @int`,
 * `@level d6`) is part of one that cannot be made: text is read once its references that name a
 * number are filled in, so one left names none, and the roll beside it rolls nothing. An `@` inside
 * a word (an address) is none.
 */
import { checkSeparatorSource, CHECK_TARGET_SOURCE, splitCheckText } from '../dice/splitCheck';
import { parseFormula } from './parseFormula';

/** A piece of a text: words, or a roll written in it with the formula a click on it rolls. */
export interface RollPiece {
  readonly text: string;
  /** What the piece rolls; null for plain words. */
  readonly formula: string | null;
}

/** Nothing of a word or a number stands right before a roll, nor right after any of its terms. */
const OPENS = String.raw`(?<![\p{L}\p{N}_])`;
const ENDS = String.raw`(?![\p{L}\p{N}_])`;

/**
 * Dice with their modifiers, in the order the parser reads them: reroll, explode (not a single bare `!`), keep or drop, count.
 * With `bare`, a die written with a count and no faces (`2d`) counts too; a lone `d` never does.
 */
function dieSource(bare: boolean): string {
  return [
    bare ? String.raw`(?:\d*d(?:\d+|%|f)|\d+d)` : String.raw`\d*d(?:\d+|%|f)`,
    String.raw`(?:r[or]?(?:(?:<=|>=|<|>)?\d+)?)?`,
    String.raw`(?:!!(?:\d+|i)?|!(?:\d+|i)|xo?(?:>=?\d+)?)?`,
    String.raw`(?:[kd][hl]?\d*)?`,
    String.raw`(?:(?:c[sf](?:>=|<=|[<>=])|>=|<=)\d+)?`,
  ].join('');
}
const LABEL = String.raw`(?:\[[\p{L}\p{N} '\-]{1,24}\])?`;
const SIGN = '[+\\-−]';
const OPERATOR = String.raw`[ \t]*(?:\+[ \t]*-|[+\-−–*/×])[ \t]*`;

function rollsPattern(bare: boolean): RegExp {
  const die = dieSource(bare);
  const dieTerm = `${die}${LABEL}${ENDS}`;
  const term = String.raw`(?:${die}|\d+(?!\.\d))${LABEL}${ENDS}`;
  return new RegExp(
    String.raw`${OPENS}(?:(?:ATK|Attack)[ \t]*:[ \t]*${SIGN}${term}|${SIGN}${term}|${dieTerm})(?:${OPERATOR}${term})*`,
    'giu',
  );
}

const ROLLS = rollsPattern(false);
const BARE_ROLLS = rollsPattern(true);

const REFERENCE_AFTER = /^[\s()+\-−–*/×]*(?<![\w.])@[A-Za-z_]/;
const REFERENCE_BEFORE = /(?<![\w.])@[A-Za-z_][\w.-]*[\s()+\-−–*/×]*$/;

/** A roll as written, spelled as the parser reads it: no label, a plain minus and times, `+ -` as `-`. */
function spelled(written: string): string {
  return written
    .trim()
    .replace(/^(?:ATK|Attack)[ \t]*:[ \t]*/i, '')
    .replace(/[−–]/g, '-')
    .replace(/×/g, '*')
    .replace(/\+[ \t]*-/g, '-');
}

/** A formula as written, as the dice tool rolls it: no spaces (but in a label), no label before it; a bare bonus stays bare. */
function stripped(spelledFormula: string): string {
  return spelledFormula.replace(/\s+(?![^[]*\])/g, '');
}

/**
 * A roll as written, as the formula the dice tool rolls: no spaces (but in a label), no label before
 * it; a bare bonus stays bare. A check (`3d6 vs 14`, `1d20 + 5 ≥ 15`) is split on its separator first,
 * so its spaces go from the formula alone: `3d6 vs 14`, `1d20+5≥15`.
 */
export function toRollFormula(written: string): string {
  const text = spelled(written);
  const check = splitCheckText(text);
  if (check === null) return stripped(text);
  return `${stripped(check.formula)}${check.mark === undefined ? ' vs ' : check.mark}${check.target}`;
}

/**
 * Whether a formula is a roll: the parser accepts it, and it throws dice or opens with a sign.
 * `defaultFaces`: the faces of a die written without them (`2d`); unset, it is no die.
 */
export function isRollFormula(formula: string, defaultFaces?: number): boolean {
  const parsed = parseFormula(formula, undefined, defaultFaces);
  return parsed.ok && (/^[+-]/.test(formula) || parsed.terms.some((term) => term.kind === 'dice' && term.count > 0));
}

/** The formula a text written as one roll rolls, or null where it is no roll. */
export function writtenRoll(written: string, defaultFaces?: number): string | null {
  const text = spelled(written);
  const check = splitCheckText(text);
  return isRollFormula(check?.formula ?? text, defaultFaces) ? toRollFormula(written) : null;
}

/** A check's separator and target right after a roll in running text: `vs` between spaces, or `≤`/`≥`; the target ends before a letter, a digit or a decimal point's digits. */
const CHECK_TAIL = new RegExp(`^${checkSeparatorSource('[ \\t]')}${CHECK_TARGET_SOURCE}(?![\\p{L}\\p{N}_]|\\.\\d)`, 'iu');

/** How many characters of `after` (the text right after a roll) are the check made of it, 0 for none. */
function checkTail(after: string): number {
  return CHECK_TAIL.exec(after)?.[0].length ?? 0;
}

/** A die with a count and no faces on its own: in running text it is a word ("a 3d model"), not a roll. */
const LONE_BARE_DIE = /^\d+d$/i;

/**
 * The text in pieces as running text reads it, before a stray number sends it to be read whole.
 * `loneBareDice`: a die with a count and no faces on its own (`2d cut`) is a roll, as in statblock text.
 */
function scanned(text: string, defaultFaces: number | undefined, loneBareDice: boolean): RollPiece[] {
  const pieces: RollPiece[] = [];
  const words = (part: string): void => {
    const last = pieces[pieces.length - 1];
    if (last && last.formula === null) pieces[pieces.length - 1] = { text: last.text + part, formula: null };
    else pieces.push({ text: part, formula: null });
  };
  let at = 0;
  const pattern = new RegExp(defaultFaces === undefined ? ROLLS : BARE_ROLLS);
  // A match that starts inside a check's tail is dropped and the search restarts where the check ends.
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    if (found.index < at) {
      pattern.lastIndex = at;
      continue;
    }
    if (found.index > at) words(text.slice(at, found.index));
    const end = found.index + found[0].length + checkTail(text.slice(found.index + found[0].length));
    const joined = REFERENCE_AFTER.test(text.slice(end)) || REFERENCE_BEFORE.test(text.slice(0, found.index));
    const written = text.slice(found.index, end);
    const formula = joined || (defaultFaces !== undefined && !loneBareDice && LONE_BARE_DIE.test(written)) ? null : writtenRoll(written, defaultFaces);
    if (formula === null) words(written);
    else pieces.push({ text: written, formula });
    at = end;
    pattern.lastIndex = at;
  }
  if (at < text.length) words(text.slice(at));
  return pieces;
}

/** The whole text as one roll, its spaces around it as words; null where it is no roll. */
function wholeRoll(text: string, defaultFaces: number | undefined): RollPiece[] | null {
  const written = text.trim();
  const formula = written === '' ? null : writtenRoll(written, defaultFaces);
  if (formula === null) return null;
  const at = text.indexOf(written);
  const pieces: RollPiece[] = [
    { text: text.slice(0, at), formula: null },
    { text: written, formula },
    { text: text.slice(at + written.length), formula: null },
  ];
  return pieces.filter((piece) => piece.text !== '');
}

function piecesOf(text: string, defaultFaces: number | undefined, loneBareDice: boolean): RollPiece[] {
  const pieces = scanned(text, defaultFaces, loneBareDice);
  const strayNumber = pieces.some((piece) => piece.formula === null && /\d/.test(piece.text));
  return strayNumber ? wholeRoll(text, defaultFaces) ?? pieces : pieces;
}

/**
 * A note's text in pieces: its words, and every roll written in it on its own. `defaultFaces`: the
 * faces of a die written with a count and no faces (`2d`), for a set that opts in; unset, it is no
 * roll. In prose a die without faces needs a modifier, an operator or a check after it ("a 3d model").
 */
export function rollPieces(text: string, defaultFaces?: number): RollPiece[] {
  return piecesOf(text, defaultFaces, false);
}

/**
 * Statblock text in pieces: as `rollPieces`, but statblock text is game data, so where the set
 * opts in (`defaultFaces`) a die with a count and no faces on its own (`2d cut`, `3d (fire)`) is a roll.
 */
export function statblockRollPieces(text: string, defaultFaces?: number): RollPiece[] {
  return piecesOf(text, defaultFaces, true);
}
