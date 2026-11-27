import { describe, expect, it, vi } from 'vitest';


import { DEFAULT_DICE_RULES } from '../../src/app/gameSystems/diceRules';
import { rollStatblockDice, type OffMapRolls } from '../../src/app/services/statblockRolls';
import { withArmedBonuses } from '../../src/app/statblocks/rollBonuses/bonusFormula';
import { ArmedBonuses } from '../../src/app/statblocks/rollBonuses/armedBonuses';
import { rollDiceFormula } from '../../src/app/tools/DiceTool';

const appWith = () => ({ workspace: { getLeavesOfType: () => [] }, vault: { getFileByPath: () => null } }) as never;

/** Rolls as the note beside a statblock does, `onRoll` told of every formula and whether it rolled. */
function offMap(onRoll: (formula: string, rolled: boolean) => void = () => undefined): OffMapRolls {
  return {
    roll: (formula, source) => {
      const result = rollDiceFormula(formula, DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'r', roller: () => 'GM', onFormulaError: () => undefined });
      onRoll(formula, result !== null);
      return result && { ...result, source };
    },
    show: () => undefined,
  };
}

const PROFICIENCY = 'proficiency';
const STEALTH = 'stealth';
/** What a card shows of Mira's values that add to rolls. */
const SHOWN = new Map([[PROFICIENCY, { label: 'Proficiency', value: 2 }], [STEALTH, { label: 'Stealth', value: 1 }]]);
const mira = (armable = SHOWN): { key: string; armable: typeof SHOWN } => ({ key: 'note:Mira.md', armable });

describe('a statblock roll with armed values', () => {
  it('adds every armed value as a term of its own, then disarms them', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    store.toggle('note:Mira.md', STEALTH);
    const order: string[] = [];
    store.subscribe('note:Mira.md', () => order.push(`disarmed ${store.armed('note:Mira.md').length}`));
    const result = rollStatblockDice(app, '+3', { statblockPath: 'Mira.md', bonuses: mira() }, offMap((formula) => order.push(`rolled ${formula}`)));
    expect(result).toMatchObject({ formula: '1d20+3+2[Proficiency]+1[Stealth]', modifiers: 6, total: 17 });
    expect(result?.namedModifiers).toEqual([{ label: 'Proficiency', value: 2 }, { label: 'Stealth', value: 1 }]);
    // Disarmed after the roll is out, in one change.
    expect(order).toEqual(['rolled +3+2[Proficiency]+1[Stealth]', 'disarmed 0']);
  });

  it('takes only its own statblock\'s values, as its card shows them now', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Goblin.md', PROFICIENCY);
    expect(rollStatblockDice(app, '+3', { bonuses: mira() }, offMap())?.formula).toBe('1d20+3');
    expect(store.armed('note:Goblin.md')).toEqual([PROFICIENCY]);
    store.toggle('note:Mira.md', PROFICIENCY);
    store.toggle('note:Mira.md', STEALTH);
    const changed = new Map([[PROFICIENCY, { label: 'Proficiency', value: 3 }]]);
    expect(rollStatblockDice(app, '+3', { bonuses: mira(changed) }, offMap())?.formula).toBe('1d20+3+3[Proficiency]');
    // A value the card no longer shows is not added, and stays armed.
    expect(store.armed('note:Mira.md')).toEqual([STEALTH]);
  });

  it('leaves them armed where the roll is refused: the formula grows past a limit, or nothing rolls it', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    const huge = new Map([[PROFICIENCY, { label: 'Proficiency', value: 12_000 }]]);
    expect(rollStatblockDice(app, '+3', { bonuses: mira(huge) }, offMap())).toBeNull();
    expect(store.armed('note:Mira.md')).toEqual([PROFICIENCY]);
    expect(rollStatblockDice(app, '1d20', { bonuses: mira() })).toBeNull();
    expect(store.armed('note:Mira.md')).toEqual([PROFICIENCY]);
  });

  it('refuses a formula the values take past the character limit before anything is rolled', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    const long = new Map(Array.from({ length: 4 }, (_, i) => [`v${i}`, { label: 'L'.repeat(24), value: 1 }] as const));
    for (const id of long.keys()) store.toggle('k', id);
    const random = vi.fn(() => 0.5);
    const note: OffMapRolls = {
      roll: (formula) => rollDiceFormula(formula, DEFAULT_DICE_RULES, { random, rollId: () => 'r', roller: () => 'GM', onFormulaError: () => undefined }),
      show: () => undefined,
    };
    expect(rollStatblockDice(app, '1d20+5', { bonuses: { key: 'k', armable: long } }, note)).toBeNull();
    expect(random).not.toHaveBeenCalled();
    expect(store.armed('k')).toHaveLength(4);
  });

  it('is not taken by a roll that names no statblock\'s values (hit points)', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    const result = rollStatblockDice(app, '2d8+4', { statblockPath: 'Mira.md' }, offMap());
    expect(result?.formula).toBe('2d8+4');
    expect(store.armed('note:Mira.md')).toEqual([PROFICIENCY]);
  });

  it('adds its values to the formula of a check, not to its target', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    const thrown: string[] = [];
    const result = rollStatblockDice(app, '3d6 vs 14', { bonuses: mira() }, offMap((formula) => thrown.push(formula)));
    expect(thrown).toEqual(['3d6+2[Proficiency] vs 14']);
    expect(result?.formula).toBe('3d6+2[Proficiency] vs 14');
    expect(result?.check).toMatchObject({ target: 14 });
    expect(store.armed('note:Mira.md')).toEqual([]);
  });

  it('moves the target of a check the set rolls under, by the set the roll is thrown with', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    const under = { dice: [{ count: 3, sides: 6 }], crit: 'none' as const, check: 'under' as const };
    const thrown: string[] = [];
    const rolls = offMap((formula) => thrown.push(formula));
    const result = rollStatblockDice(app, '3d6 vs 14', { bonuses: mira() }, { ...rolls, rollingDice: () => under });
    expect(thrown).toEqual(['3d6 vs 16']);
    expect(result?.check).toMatchObject({ target: 16 });
  });

  it('keeps the direction written with a check, and completes a bare bonus check with the set\'s dice', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', PROFICIENCY);
    expect(rollStatblockDice(app, '1d20+5 ≥ 15', { bonuses: mira() }, offMap())?.formula).toBe('1d20+5+2[Proficiency] ≥ 15');
    store.toggle('note:Mira.md', PROFICIENCY);
    expect(rollStatblockDice(app, '+3 vs 14', { bonuses: mira() }, offMap())?.formula).toBe('1d20+3+2[Proficiency] vs 14');
  });

  it('reads a bare die in a check by the faces of the set that opts in', () => {
    const armed = [{ id: PROFICIENCY, label: 'Proficiency', value: 2 }];
    expect(withArmedBonuses('3d vs 14', armed, { dice: [{ count: 1, sides: 6 }], crit: 'none', check: 'over', bareDie: true })).toBe('3d+2[Proficiency] vs 14');
    expect(withArmedBonuses('3d vs 14', armed)).toBe('3d vs 14+2[Proficiency]');
  });
});

describe('a statblock roll that moves its target', () => {
  const under = { dice: [{ count: 3, sides: 6 }], crit: 'none' as const, check: 'under' as const };
  const AGILITY = 'agility';
  const agility = new Map([[AGILITY, { label: 'Agility', value: 2 }], [STEALTH, { label: 'Stealth', value: -1 }]]);
  /** Rolls as the note beside a statblock does, by a set that rolls under; `thrown` hears every formula. */
  const underRolls = (thrown: string[] = []): OffMapRolls => ({
    roll: (formula, source, options) => {
      thrown.push(formula);
      const result = rollDiceFormula(formula, under, { random: () => 0.5, rollId: () => 'r', roller: () => 'GM', onFormulaError: () => undefined }, undefined, options?.advantage, false, options?.targetSteps);
      return result && { ...result, source };
    },
    rollingDice: () => under,
    show: () => undefined,
  });

  it('records the armed bonus on the result: 15 under with Agility +2 is 17', () => {
    const app = appWith();
    ArmedBonuses.forApp(app).toggle('note:Mira.md', AGILITY);
    const thrown: string[] = [];
    const result = rollStatblockDice(app, '3d6 vs 15', { bonuses: mira(agility) }, underRolls(thrown));
    expect(thrown).toEqual(['3d6 vs 17']);
    expect(result?.formula).toBe('3d6 vs 17');
    expect(result?.check).toMatchObject({ target: 17, baseTarget: 15, targetSteps: [{ label: 'Agility', value: 2 }] });
  });

  it('puts a one-off modifier first, labelled Modifier, then the armed bonuses', () => {
    const app = appWith();
    ArmedBonuses.forApp(app).toggle('note:Mira.md', AGILITY);
    const result = rollStatblockDice(app, '3d6 vs 14', { bonuses: mira(agility), targetSteps: [{ label: 'Modifier', value: 1 }] }, underRolls());
    expect(result?.check).toMatchObject({ target: 16, baseTarget: 13, targetSteps: [{ label: 'Modifier', value: 1 }, { label: 'Agility', value: 2 }] });
  });

  it('records no steps for an over check or an unmoved target', () => {
    const app = appWith();
    const store = ArmedBonuses.forApp(app);
    store.toggle('note:Mira.md', AGILITY);
    expect(rollStatblockDice(app, '1d20 vs 15', { bonuses: mira(agility) }, offMap())?.check).not.toHaveProperty('targetSteps');
    expect(rollStatblockDice(app, '3d6 vs 15', {}, underRolls())?.check).not.toHaveProperty('targetSteps');
  });
});
