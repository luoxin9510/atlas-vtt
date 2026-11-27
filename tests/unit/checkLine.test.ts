import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { TRANSLATIONS } from '../../src/app/i18n/languages';
import { checkLine, shownCrit } from '../../src/app/dice/checkLine';
import type { CheckResult } from '../../src/app/dice/checkTypes';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

function check(margin: number, crit: CheckResult['crit'] = null): CheckResult {
  return { target: 12, direction: 'under', margin, success: margin >= 0, crit, rule: 'margin' };
}

function rolled(over: Partial<DiceRollResult> = {}): DiceRollResult {
  return { id: 'r', timestamp: 0, formula: '3d6 vs 12', rolls: [], modifiers: 0, total: 9, ...over };
}

afterEach(() => setLocale('en', TRANSLATIONS));

describe('checkLine', () => {
  it('is null for a roll without a check', () => {
    expect(checkLine(rolled())).toBeNull();
  });

  it('names success and failure by the size of the margin', () => {
    expect(checkLine(rolled({ check: check(3) }))).toBe('Success by 3');
    expect(checkLine(rolled({ check: check(0) }))).toBe('Success by 0');
    expect(checkLine(rolled({ check: check(-2) }))).toBe('Failure by 2');
  });

  it('names a critical success without a margin and a critical failure with one', () => {
    expect(checkLine(rolled({ check: check(5, 'success') }))).toBe('Critical success');
    expect(checkLine(rolled({ check: check(-11, 'failure') }))).toBe('Critical failure by 11');
  });

  it('names a critical failure that still met its target without a margin', () => {
    expect(checkLine(rolled({ check: check(6, 'failure') }))).toBe('Critical failure');
    expect(checkLine(rolled({ check: check(0, 'failure') }))).toBe('Critical failure');
    expect(checkLine(rolled({ check: check(-1, 'failure') }))).toBe('Critical failure by 1');
    expect(checkLine(rolled({ check: check(-4, 'success') }))).toBe('Critical success');
    setLocale('zh', TRANSLATIONS);
    expect(checkLine(rolled({ check: check(6, 'failure') }))).toBe('大失败');
  });

  it('reads in Chinese', () => {
    setLocale('zh', TRANSLATIONS);
    expect(checkLine(rolled({ check: check(3) }))).toBe('成功，超出 3');
    expect(checkLine(rolled({ check: check(-2) }))).toBe('失败，差 2');
    expect(checkLine(rolled({ check: check(5, 'success') }))).toBe('大成功');
    expect(checkLine(rolled({ check: check(-11, 'failure') }))).toBe('大失败，差 11');
  });
});

describe('shownCrit', () => {
  it('is the dice crit for a roll without a check', () => {
    expect(shownCrit(rolled({ crit: 'high' }))).toBe('high');
    expect(shownCrit(rolled({ crit: 'low' }))).toBe('low');
    expect(shownCrit(rolled())).toBeNull();
  });

  it('follows the check when there is one, in both directions', () => {
    expect(shownCrit(rolled({ crit: 'high', check: check(-3) }))).toBeNull();
    expect(shownCrit(rolled({ crit: 'high', check: check(-3, 'failure') }))).toBe('low');
    expect(shownCrit(rolled({ crit: 'low', check: check(4, 'success') }))).toBe('high');
    expect(shownCrit(rolled({ crit: 'low', check: check(4) }))).toBeNull();
  });
});
