import { describe, expect, it } from 'vitest';
import { diceAverage, parseDiceNotation } from '../../src/app/statblocks/values/diceNotation';
import { coerce } from '../../src/app/statblocks/values/valueCoercion';
import { splitDiceSegments } from '../../src/app/services/statblockDiceText';
import { isDiceValue } from '../../src/app/statblocks/values/diceValues';
import { isRollFormula, rollPieces, statblockRollPieces, toRollFormula, writtenRoll } from '../../src/app/tools/textRolls';

/** The rolls a text holds: what stands there, and the formula it throws. */
const rolls = (text: string, defaultFaces?: number): [string, string][] =>
  rollPieces(text, defaultFaces).flatMap((piece) => (piece.formula === null ? [] : [[piece.text, piece.formula] as [string, string]]));

describe('dice without faces in text rolls', () => {
  it('are no roll when the option is off', () => {
    expect(writtenRoll('1d+2')).toBeNull();
    expect(isRollFormula('2d-1')).toBe(false);
    expect(rolls('Deals 1d+2 damage')).toEqual([]);
    expect(isDiceValue('1d+1')).toBe(false);
  });

  it('are a roll when the option is on, as the formula the user wrote', () => {
    expect(writtenRoll('1d+2', 6)).toBe('1d+2');
    expect(writtenRoll('2d - 1', 6)).toBe('2d-1');
    expect(writtenRoll('3d', 6)).toBe('3d');
    expect(isRollFormula('2d-1', 6)).toBe(true);
    expect(toRollFormula('1d + 2')).toBe('1d+2');
    expect(isDiceValue('1d+1', 6)).toBe(true);
  });

  it('are found in running text', () => {
    expect(rolls('Deals 1d+2 damage', 6)).toEqual([['1d+2', '1d+2']]);
    expect(rolls('Hit for 2d-1 or 3d*2.', 6)).toEqual([['2d-1', '2d-1'], ['3d*2', '3d*2']]);
  });

  it('need a count, and never start or end inside a word', () => {
    expect(rolls('the d is a letter, a d+2 too', 6)).toEqual([]);
    expect(rolls('xd+2 and 2days and hd6', 6)).toEqual([]);
  });

  it('leave faces, percent, fate and a lone d as they were', () => {
    expect(rolls('1d6 and 1d% and 4dF and d20', 6)).toEqual([['1d6', '1d6'], ['1d%', '1d%'], ['4dF', '4dF'], ['d20', 'd20']]);
    expect(writtenRoll('d20+3', 6)).toBe('d20+3');
    expect(writtenRoll('4d6kh3', 10)).toBe('4d6kh3');
  });

  it('read check text as one roll, as faced dice are (task 6b: a check is no longer a roll followed by words)', () => {
    expect(rolls('3d vs 12', 6)).toEqual([['3d vs 12', '3d vs 12']]);
    expect(rolls('3d6 vs 12')).toEqual([['3d6 vs 12', '3d6 vs 12']]);
    expect(rolls('3d vs 12')).toEqual([]);
  });
});

describe('a die without faces in prose', () => {
  it('is no roll unless a modifier, an operator or a check follows it', () => {
    expect(rolls('The 3d model', 6)).toEqual([]);
    expect(rolls('A 2d grid on a 3d map', 6)).toEqual([]);
    expect(rolls('Use 3d. Then 2d, 4d!', 6)).toEqual([]);
    expect(rolls('Roll 1d+2, 2d-1 and 3d*2', 6)).toEqual([['1d+2', '1d+2'], ['2d-1', '2d-1'], ['3d*2', '3d*2']]);
    expect(rolls('Roll 3d vs 14 or 3d ≤ 12', 6)).toEqual([['3d vs 14', '3d vs 14'], ['3d ≤ 12', '3d≤12']]);
    expect(rolls('1d+2', 6)).toEqual([['1d+2', '1d+2']]);
  });

  it('still reads a lone die as a whole value', () => {
    expect(writtenRoll('3d', 6)).toBe('3d');
    expect(isRollFormula('3d', 6)).toBe(true);
    expect(isDiceValue('3d', 6)).toBe(true);
    expect(coerce('dice', '3d', undefined, 6)).toMatchObject({ ok: true, value: '3d' });
  });
});

describe('dice notation without faces', () => {
  it('is none when the option is off', () => {
    expect(parseDiceNotation('1d+2')).toBeNull();
    expect(diceAverage('1d+2')).toBeNull();
  });

  it('reads the default die when it is on', () => {
    expect(parseDiceNotation('2d-1', 6)).toEqual({ dice: [{ sign: 1, count: 2, sides: 6 }], modifier: -1 });
    expect(diceAverage('1d+2', 6)).toBe(5);
    expect(diceAverage('2d', 10)).toBe(11);
    expect(diceAverage('(1d+2)', 6)).toBe(5);
  });

  it('keeps faced dice', () => {
    expect(diceAverage('1d8+2', 6)).toBe(6);
    expect(diceAverage('d20', 6)).toBe(10);
    expect(diceAverage('d', 6)).toBeNull();
  });
});

describe('a statblock dice field and text without faces', () => {
  it('refuses a die without faces unless the set opts in', () => {
    expect(coerce('dice', '1d+1').ok).toBe(false);
    expect(coerce('dice', '1d+1', undefined, 6)).toMatchObject({ ok: true, value: '1d+1' });
    expect(coerce('dice', '2d6+1', undefined, 6)).toMatchObject({ ok: true, value: '2d6+1' });
  });

  it('links a roll in statblock text only when the set opts in', () => {
    expect(splitDiceSegments('Bite 1d+2 damage').some((segment) => segment.dice)).toBe(false);
    expect(splitDiceSegments('Bite 1d+2 damage', 6)).toEqual([
      { text: 'Bite ', dice: false }, { text: '1d+2', dice: true }, { text: ' damage', dice: false },
    ]);
  });
});

describe('a die without faces in statblock text', () => {
  /** The rolls statblock text holds, as the card links them. */
  const cardRolls = (text: string, defaultFaces?: number): [string, string][] =>
    statblockRollPieces(text, defaultFaces).flatMap((piece) => (piece.formula === null ? [] : [[piece.text, piece.formula] as [string, string]]));

  it('is a roll wherever it stands when the set opts in', () => {
    expect(cardRolls('2d cut', 6)).toEqual([['2d', '2d']]);
    expect(cardRolls('sw 2d cut, thr 1d+1 imp', 6)).toEqual([['2d', '2d'], ['1d+1', '1d+1']]);
    expect(cardRolls('3d (fire)', 6)).toEqual([['3d', '3d']]);
    expect(cardRolls('Roll 3d.', 6)).toEqual([['3d', '3d']]);
    expect(splitDiceSegments('sw 2d cut', 6)).toEqual([{ text: 'sw ', dice: false }, { text: '2d', dice: true }, { text: ' cut', dice: false }]);
  });

  it('is no roll when the set does not opt in', () => {
    expect(cardRolls('2d cut')).toEqual([]);
    expect(cardRolls('sw 2d cut, thr 1d+1 imp')).toEqual([]);
  });

  it('reads faced dice as it always did', () => {
    expect(cardRolls('Bite 1d6+2 and 2d6', 6)).toEqual([['1d6+2', '1d6+2'], ['2d6', '2d6']]);
  });
});
