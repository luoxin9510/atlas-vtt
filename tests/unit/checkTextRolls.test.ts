import { describe, expect, it } from 'vitest';
import { rollPieces, toRollFormula, writtenRoll } from '../../src/app/tools/textRolls';

/** The rolls a text holds: what stands there, and the formula it throws. */
const rolls = (text: string, defaultFaces?: number): [string, string][] =>
  rollPieces(text, defaultFaces).flatMap((piece) => (piece.formula === null ? [] : [[piece.text, piece.formula] as [string, string]]));

describe('check text in text rolls', () => {
  it('is one roll with its target, not dice followed by words', () => {
    expect(rolls('Roll 3d6 vs 14 to climb.')).toEqual([['3d6 vs 14', '3d6 vs 14']]);
    expect(rolls('Make a 3D6 VS 14 check')).toEqual([['3D6 VS 14', '3D6 vs 14']]);
    expect(rolls('Try 1d20+5 ≥ 15 or 1d20+3≥12!')).toEqual([['1d20+5 ≥ 15', '1d20+5≥15'], ['1d20+3≥12', '1d20+3≥12']]);
    expect(rolls('Under: 3d6 ≤ 10.')).toEqual([['3d6 ≤ 10', '3d6≤10']]);
  });

  it('splits on the separator before it strips spaces, and keeps `vs` apart', () => {
    expect(rolls('1d20 + 5 vs 15')).toEqual([['1d20 + 5 vs 15', '1d20+5 vs 15']]);
    expect(rolls('4d10>=8 vs 2')).toEqual([['4d10>=8 vs 2', '4d10>=8 vs 2']]);
    expect(writtenRoll('3d6 vs 14')).toBe('3d6 vs 14');
    expect(toRollFormula('3d6  vs  -2')).toBe('3d6 vs -2');
  });

  it('leaves the tally `3d6<=14` as one tally piece, and other `vs` text alone', () => {
    expect(rolls('Count 3d6<=14 now')).toEqual([['3d6<=14', '3d6<=14']]);
    expect(rolls('3d6 vs Kara')).toEqual([['3d6', '3d6']]);
    expect(rolls('3d6 vsomething 14')).toEqual([['3d6', '3d6']]);
    expect(rolls('3d6 vs 14.5')).toEqual([['3d6', '3d6']]);
    expect(rolls('3d6 vs 14th')).toEqual([['3d6', '3d6']]);
  });

  it('takes a bare die check only where the set opts in', () => {
    expect(rolls('Roll 3d vs 12')).toEqual([]);
    expect(rolls('Roll 3d vs 12', 6)).toEqual([['3d vs 12', '3d vs 12']]);
  });

  it('reads a whole value as a check too', () => {
    expect(rollPieces(' 2 + 1d6 vs 10 ')).toEqual([{ text: ' ', formula: null }, { text: '2 + 1d6 vs 10', formula: '2+1d6 vs 10' }, { text: ' ', formula: null }]);
  });

  it('is exactly one roll piece, whatever its target, and the pieces joined are the text', () => {
    const texts = [
      'Save 1d6 vs -3 now', 'Save 1d6 vs +5 now', 'Save 1d6 vs 3 now', 'Try 1d20+5 ≥ -2 or 3d6 ≤ +10.',
      '1d6 vs -3', 'x 3d6≤-4 y', 'x 3d6≥+4 y',
    ];
    for (const text of texts) {
      const pieces = rollPieces(text);
      expect(pieces.map((piece) => piece.text).join(''), text).toBe(text);
      const rolled = pieces.filter((piece) => piece.formula !== null).length;
      expect(rolled, text).toBe((text.match(/vs|≤|≥/g) ?? []).length);
    }
    expect(rolls('Save 1d6 vs -3 now')).toEqual([['1d6 vs -3', '1d6 vs -3']]);
    expect(rolls('Save 1d6 vs +5 now')).toEqual([['1d6 vs +5', '1d6 vs 5']]);
    for (const text of ['Save 3d vs -3 now', 'Save 3d ≥ +5 now']) {
      const pieces = rollPieces(text, 6);
      expect(pieces.map((piece) => piece.text).join(''), text).toBe(text);
      expect(pieces.filter((piece) => piece.formula !== null), text).toHaveLength(1);
    }
  });
});
