import { describe, expect, it } from 'vitest';
import { withTargetModifier } from '../../../src/app/tools/targetModifier';
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
