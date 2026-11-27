import { describe, expect, it } from 'vitest';
import { parseFormula, type DiceTerm } from '../parseFormula';
import type { RollParseOptions } from '../formulaTypes';

function diceOf(formula: string, options: RollParseOptions = {}): DiceTerm | null {
  const result = parseFormula(formula, undefined, options);
  return result.ok ? (result.terms.find((term): term is DiceTerm => term.kind === 'dice') ?? null) : null;
}

describe('parseFormula with defaultFaces', () => {
  it('refuses a die without faces when no default is given', () => {
    expect(parseFormula('1d+2').ok).toBe(false);
    expect(parseFormula('3d').ok).toBe(false);
  });

  it('reads a die without faces as the default die', () => {
    expect(diceOf('1d+2', { defaultFaces: 6 })).toMatchObject({ count: 1, faces: 6 });
    expect(diceOf('2d-1', { defaultFaces: 6 })).toMatchObject({ count: 2, faces: 6 });
    expect(diceOf('3d', { defaultFaces: 10 })).toMatchObject({ count: 3, faces: 10 });
  });

  it('keeps explicit faces, percent and fate as they are', () => {
    expect(diceOf('1d6', { defaultFaces: 10 })).toMatchObject({ count: 1, faces: 6 });
    expect(diceOf('1d%', { defaultFaces: 10 })).toMatchObject({ count: 1, faces: 100 });
    expect(diceOf('4dF', { defaultFaces: 10 })).toMatchObject({ count: 4, fate: true });
    expect(diceOf('d20', { defaultFaces: 10 })).toMatchObject({ count: 1, faces: 20 });
  });

  it('needs a count: a lone d is not a bare die', () => {
    expect(parseFormula('d+2', undefined, { defaultFaces: 6 }).ok).toBe(false);
  });

  it('lets modifiers follow a bare die', () => {
    expect(diceOf('4dkh3', { defaultFaces: 6 })).toMatchObject({ count: 4, faces: 6, keep: { mode: 'keep', end: 'highest', count: 3 } });
  });
});
