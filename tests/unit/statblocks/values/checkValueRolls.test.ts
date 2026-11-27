import { describe, expect, it } from 'vitest';
import { rollStatblockDice, type OffMapRolls } from '../../../../src/app/services/statblockRolls';
import { ArmedBonuses } from '../../../../src/app/statblocks/rollBonuses/armedBonuses';
import { rollModeOf } from '../../../../src/app/statblocks/model/templateTypes';
import { bonusLink, valueRoll } from '../../../../src/app/statblocks/values/valueRolls';

const UNDER = { checkRoll: '3d6' };

describe('a value rolled as a check', () => {
  it('rolls its leading whole number as the target of the set\'s default roll', () => {
    expect(valueRoll('15', 'check', UNDER)).toBe('3d6 vs 15');
    expect(bonusLink('15', 'check', UNDER)).toBe('3d6 vs 15');
  });

  it('reads only the leading number of a value with a note after it', () => {
    expect(valueRoll('15 (DX+2)', 'check', UNDER)).toBe('3d6 vs 15');
    expect(valueRoll('  9 / 12', 'check', UNDER)).toBe('3d6 vs 9');
  });

  it('links nothing without a leading whole number, or where the set is not known', () => {
    expect(valueRoll('—', 'check', UNDER)).toBeNull();
    expect(valueRoll('', 'check', UNDER)).toBeNull();
    expect(valueRoll('DX 15', 'check', UNDER)).toBeNull();
    // A signed number is a bonus, not a target: no check link (the text links a bonus of its own, as anywhere)
    expect(bonusLink('-1', 'check', UNDER)).toBeNull();
    expect(bonusLink('+2', 'check', UNDER)).toBeNull();
    expect(valueRoll('15', 'check')).toBeNull();
  });

  it('leaves a bonus as it was', () => {
    expect(valueRoll('2', true)).toBe('+2');
    expect(valueRoll('2', 'bonus', UNDER)).toBe('+2');
    expect(bonusLink('2', true, UNDER)).toBe('+2');
    expect(valueRoll('2', undefined, UNDER)).toBeNull();
  });
});

describe('the mode a block rolls in', () => {
  it('is a bonus for rollable, a check for rollAs check, a check winning where both are written', () => {
    expect(rollModeOf({ rollable: true })).toBe('bonus');
    expect(rollModeOf({ rollAs: 'check' })).toBe('check');
    expect(rollModeOf({ rollable: true, rollAs: 'check' })).toBe('check');
    expect(rollModeOf({})).toBeUndefined();
  });
});

describe('a check link with armed values', () => {
  it('moves the target of an under check by what is armed', () => {
    const app = { workspace: { getLeavesOfType: () => [] }, vault: { getFileByPath: () => null } } as never;
    ArmedBonuses.forApp(app).toggle('note:Mira.md', 'proficiency');
    const thrown: string[] = [];
    const rolls: OffMapRolls = {
      rollingDice: () => ({ dice: [{ count: 3, sides: 6 }], crit: 'none', check: 'under' }),
      roll: (formula) => { thrown.push(formula); return null; },
      show: () => undefined,
    };
    const armable = new Map([['proficiency', { label: 'Proficiency', value: 2 }]]);
    rollStatblockDice(app, valueRoll('15', 'check', UNDER)!, { bonuses: { key: 'note:Mira.md', armable } }, rolls);
    expect(thrown).toEqual(['3d6 vs 17']);
  });
});
