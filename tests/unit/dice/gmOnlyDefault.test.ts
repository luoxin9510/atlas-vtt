import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DICE_RULES } from '../../../src/app/gameSystems/diceRules';
import { DiceTool, type DiceRollInputs } from '../../../src/app/tools/DiceTool';

/** A dice tool for a GM whose GM-only switch is `gmOnly`; the dice all land on 11. */
function tool(gmOnly: boolean): DiceTool {
  let ids = 0;
  const inputs: DiceRollInputs = {
    random: () => 0.5, rollId: () => `id-${(ids += 1)}`, roller: () => 'GM', onFormulaError: vi.fn(), gmOnly: () => gmOnly,
  };
  return new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, inputs);
}

describe('the GM-only switch as the default visibility of every roll the GM makes', () => {
  it('hides a roll, a check and both sides of a contest that name no visibility, while the switch is on', () => {
    const gm = tool(true);
    expect(gm.rollDice('1d20+3')?.hidden).toBe(true);
    expect(gm.rollCheck('1d20', 12)?.hidden).toBe(true);
    const sides = gm.rollContest('1d20 vs 12', '1d20 vs 14')!;
    expect(sides.map((side) => side.hidden)).toEqual([true, true]);
    expect(gm.rollDice('12 vs 14')?.hidden).toBe(true);
    expect(gm.state.rollHistory.every((roll) => roll.hidden === true)).toBe(true);
  });

  it('lets an explicit visibility of all win: the roll stays open', () => {
    const gm = tool(true);
    expect(gm.rollDice('1d20', undefined, undefined, { visibility: 'all' })).not.toHaveProperty('hidden');
    expect(gm.rollCheck('1d20', 12, { visibility: 'all' })).not.toHaveProperty('hidden');
    const sides = gm.rollContest('1d20 vs 12', '1d20 vs 14', { visibility: 'all' })!;
    expect(sides.map((side) => side.hidden)).toEqual([undefined, undefined]);
  });

  it('still hides a roll that asks for gm, whatever the switch says', () => {
    expect(tool(false).rollDice('1d20', undefined, undefined, { visibility: 'gm' })?.hidden).toBe(true);
  });

  it('changes nothing while the switch is off, and for a tool that has no switch', () => {
    expect(tool(false).rollDice('1d20')).not.toHaveProperty('hidden');
    expect(tool(false).rollCheck('1d20', 12)).not.toHaveProperty('hidden');
    expect(tool(false).rollContest('1d20 vs 12', '1d20 vs 14')!.map((side) => side.hidden)).toEqual([undefined, undefined]);
    const bare = new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'x', roller: () => 'GM', onFormulaError: vi.fn() });
    expect(bare.rollDice('1d20')).not.toHaveProperty('hidden');
  });

  it('reads the switch at the moment of each roll', () => {
    let on = false;
    const gm = new DiceTool(new EventEmitter(), () => DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'x', roller: () => 'GM', onFormulaError: vi.fn(), gmOnly: () => on });
    expect(gm.rollDice('1d20')).not.toHaveProperty('hidden');
    on = true;
    expect(gm.rollDice('1d20')?.hidden).toBe(true);
  });
});
