import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/app/i18n';
import { TRANSLATIONS } from '../../src/app/i18n/languages';
import { checkLine, shownCrit, targetLine, modifierStepLabel } from '../../src/app/dice/checkLine';
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

describe('targetLine', () => {
  const moved = (steps: NonNullable<CheckResult['targetSteps']>, target = 17, baseTarget = 15): CheckResult =>
    ({ ...check(3), target, baseTarget, targetSteps: steps });

  it('is null for no check, an unmoved target and a check whose steps are gone', () => {
    expect(targetLine(rolled())).toBeNull();
    expect(targetLine(rolled({ check: check(3) }))).toBeNull();
    expect(targetLine(rolled({ check: { ...check(3), baseTarget: 15, targetSteps: [] } }))).toBeNull();
  });

  it('names the target it started from, where it came to and what moved it', () => {
    const line = targetLine(rolled({ check: moved([{ label: 'Agility', value: 2 }]) }));
    expect(line).toBe('Target 15 → 17 (Agility +2)');
  });

  it('joins several steps as a sum, comma-separated in the language of the roller, with a true minus for a negative one', () => {
    const steps = [{ label: 'Agility', value: 2 }, { label: 'Modifier', value: -1 }];
    expect(targetLine(rolled({ check: moved(steps, 16) }))).toBe('Target 15 → 16 (Agility +2, Modifier −1)');
    setLocale('zh', TRANSLATIONS);
    const zh = [{ label: '敏捷', value: 2 }, { label: '修正', value: -1 }];
    expect(targetLine(rolled({ check: moved(zh, 16) }))).toBe('目标 15 → 16（敏捷 +2，修正 −1）');
  });

  it('shows an unlabeled step as its signed number alone', () => {
    expect(targetLine(rolled({ check: moved([{ value: 2 }, { label: 'Modifier', value: -1 }], 16) }))).toBe('Target 15 → 16 (+2, Modifier −1)');
  });

  it('names the one-off modifier in the language of the roller', () => {
    expect(modifierStepLabel()).toBe('Modifier');
    setLocale('zh', TRANSLATIONS);
    expect(modifierStepLabel()).toBe('修正');
  });
});
