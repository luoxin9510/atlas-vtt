import { describe, expect, it } from 'vitest';
import { parseModifier, targetStepsOf, withTargetModifier } from '../../../src/app/tools/targetModifier';
import { withArmedBonuses } from '../../../src/app/statblocks/rollBonuses/bonusFormula';
import type { RollingDice } from '../../../src/app/types/diceSetTypes';

const UNDER: RollingDice = { dice: [{ count: 3, sides: 6 }], crit: 'none', check: 'under' };
const OVER: RollingDice = { dice: [{ count: 1, sides: 20 }], crit: 'none', check: 'over' };
const UNDER_BARE: RollingDice = { ...UNDER, bareDie: true };

describe('withTargetModifier', () => {
  it('moves the target of an under check', () => {
    expect(withTargetModifier('3d6 vs 15', 2, UNDER)).toBe('3d6 vs 17');
    expect(withTargetModifier('3d6 vs 15', -1, UNDER)).toBe('3d6 vs 14');
  });

  it('puts the modifier on the dice of an over check', () => {
    expect(withTargetModifier('1d20 vs 15', 2, OVER)).toBe('1d20+2 vs 15');
    expect(withTargetModifier('1d20 vs 15', -3, OVER)).toBe('1d20-3 vs 15');
  });

  it('follows a written direction before the set', () => {
    expect(withTargetModifier('1d20 ≤ 15', 2, OVER)).toBe('1d20 ≤ 17');
    expect(withTargetModifier('3d6 ≥ 15', 2, UNDER)).toBe('3d6+2 ≥ 15');
  });

  it('reads a bare die by the set that opts in', () => {
    expect(withTargetModifier('3d vs 12', 1, UNDER_BARE)).toBe('3d vs 13');
  });

  it('leaves dice terms of the formula alone', () => {
    expect(withTargetModifier('3d6+1d4 vs 15', 2, UNDER)).toBe('3d6+1d4 vs 17');
  });

  it('adds to a plain formula, with the given term when one is', () => {
    expect(withTargetModifier('2d6+3', 2, UNDER)).toBe('2d6+3+2');
    expect(withTargetModifier('2d6+3', 2, UNDER, '+2[Edge]')).toBe('2d6+3+2[Edge]');
  });
});

describe('a target that would outgrow what a check holds', () => {
  it('leaves the text unchanged where the moved target has more than nine digits', () => {
    expect(withTargetModifier('3d6 vs 999999999', 1, UNDER)).toBe('3d6 vs 999999999');
    expect(withTargetModifier('3d6 vs 999999998', 1, UNDER)).toBe('3d6 vs 999999999');
    expect(withTargetModifier('3d6 vs -999999999', -1, UNDER)).toBe('3d6 vs -999999999');
  });

  it('refuses a modifier of more than nine digits', () => {
    expect(parseModifier('999999999')).toBe(999999999);
    expect(parseModifier('+1000000000')).toBeNull();
    expect(parseModifier('-1234567890')).toBeNull();
  });
});

describe('withArmedBonuses with rules', () => {
  const armed = [{ id: 'a', label: 'Edge', value: 2 }, { id: 'b', label: 'Weight', value: -1 }];

  it('moves the target of an under check by the sum of the bonuses', () => {
    expect(withArmedBonuses('3d6 vs 15', armed, UNDER)).toBe('3d6 vs 16');
  });

  it('keeps them on the dice, labelled, for an over check', () => {
    expect(withArmedBonuses('1d20 vs 15', armed, OVER)).toBe('1d20+2[Edge]-1[Weight] vs 15');
  });

  it('keeps a plain formula as before', () => {
    expect(withArmedBonuses('3d6', armed, UNDER)).toBe('3d6+2[Edge]-1[Weight]');
  });

  it('reads a bare die and the direction from the rules', () => {
    expect(withArmedBonuses('3d vs 12', [{ id: 'a', label: 'Edge', value: 1 }], UNDER_BARE)).toBe('3d vs 13');
  });
});

describe('targetStepsOf', () => {
  const steps = [{ label: 'Agility', value: 2 }, { label: 'Modifier', value: -1 }];

  it('keeps the steps that moved the target of an under check', () => {
    expect(targetStepsOf('3d6 vs 15', steps, UNDER)).toEqual(steps);
    expect(targetStepsOf('3d6 ≤ 15', steps, OVER)).toEqual(steps);
  });

  it('is empty for an over check, a plain formula, no steps or steps that net nothing', () => {
    expect(targetStepsOf('1d20 vs 15', steps, OVER)).toEqual([]);
    expect(targetStepsOf('3d6', steps, UNDER)).toEqual([]);
    expect(targetStepsOf('3d6 vs 15', [], UNDER)).toEqual([]);
    expect(targetStepsOf('3d6 vs 15', [{ value: 0 }], UNDER)).toEqual([]);
  });

  it('is empty where the moved target would pass what a check holds', () => {
    expect(targetStepsOf('3d6 vs 999999999', [{ value: 5 }], UNDER)).toEqual([]);
  });

  it('keeps an unlabeled step as it is and drops a zero step among others', () => {
    expect(targetStepsOf('3d6 vs 15', [{ value: 2 }, { label: 'Zero', value: 0 }], UNDER)).toEqual([{ value: 2 }]);
  });
});
