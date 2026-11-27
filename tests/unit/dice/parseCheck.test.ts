import { describe, expect, it } from 'vitest';
import { parseCheck } from '../../../src/app/dice/parseCheck';
import { FORMULA_LIMITS } from '../../../src/app/tools/formulaTypes';
import { parseFormula } from '../../../src/app/tools/parseFormula';

describe('parseCheck', () => {
  it('splits a formula and a target at vs', () => {
    expect(parseCheck('3d6 vs 14')).toEqual({ formula: '3d6', target: 14 });
    expect(parseCheck('1d100 vs 45')).toEqual({ formula: '1d100', target: 45 });
  });

  it('reads vs in any case and with extra spaces', () => {
    expect(parseCheck('3d6 VS 14')).toEqual({ formula: '3d6', target: 14 });
    expect(parseCheck('  3d6   Vs   14  ')).toEqual({ formula: '3d6', target: 14 });
  });

  it('needs spaces around vs', () => {
    expect(parseCheck('3d6vs14')).toBeNull();
    expect(parseCheck('3d6 vs14')).toBeNull();
    expect(parseCheck('3d6vs 14')).toBeNull();
  });

  it('reads the signs as written and sets the direction from ≤ and ≥', () => {
    expect(parseCheck('3d6 ≤ 14')).toEqual({ formula: '3d6', target: 14, direction: 'under' });
    expect(parseCheck('1d20+5 ≥ 15')).toEqual({ formula: '1d20+5', target: 15, direction: 'over' });
    expect(parseCheck('1d20+5≥15')).toEqual({ formula: '1d20+5', target: 15, direction: 'over' });
    expect(parseCheck('3d6≤-2')).toEqual({ formula: '3d6', target: -2, direction: 'under' });
    expect(parseCheck('3d6 vs +7')).toEqual({ formula: '3d6', target: 7 });
    expect(parseCheck('3d6 vs -3')).toEqual({ formula: '3d6', target: -3 });
  });

  it('takes a target of one to nine digits', () => {
    expect(parseCheck('3d6 vs 0')).toEqual({ formula: '3d6', target: 0 });
    expect(parseCheck('3d6 vs 999999999')).toEqual({ formula: '3d6', target: 999999999 });
    expect(parseCheck('3d6 vs 1000000000')).toBeNull();
    expect(parseCheck('3d6 vs')).toBeNull();
    expect(parseCheck('3d6 vs 1.5')).toBeNull();
  });

  it('counts only the last separator, so a tally can be checked', () => {
    expect(parseCheck('4d10>=8 vs 2')).toEqual({ formula: '4d10>=8', target: 2 });
    expect(parseCheck('1d20 ≥ 5 vs 3')).toBeNull();
    expect(parseCheck('3d6 vs 3 ≤ 14')).toBeNull();
  });

  it('needs a formula that parses on its own', () => {
    expect(parseCheck('vs 14')).toBeNull();
    expect(parseCheck('banana vs 14')).toBeNull();
    expect(parseCheck('1d20 + vs 14')).toBeNull();
  });

  it('leaves ASCII comparison tallies and plain formulas alone', () => {
    expect(parseCheck('3d6<=14')).toBeNull();
    expect(parseFormula('3d6<=14').ok).toBe(true);
    expect(parseCheck('1d20+5>=15')).toBeNull();
    expect(parseCheck('3d6')).toBeNull();
    expect(parseCheck('')).toBeNull();
  });

  it('counts the whole text toward the character limit', () => {
    const fits = `3d6${' '.repeat(FORMULA_LIMITS.characters - 15)}+ 1`;
    expect(fits.length).toBeLessThanOrEqual(FORMULA_LIMITS.characters - 5);
    expect(parseCheck(`${fits} vs 5`)).toEqual({ formula: fits, target: 5 });
    const tooLong = `3d6${' '.repeat(FORMULA_LIMITS.characters - 7)}+ 1`;
    expect(tooLong.length).toBeLessThanOrEqual(FORMULA_LIMITS.characters);
    expect(parseFormula(tooLong).ok).toBe(true);
    expect(parseCheck(`${tooLong} vs 5`)).toBeNull();
  });
});
