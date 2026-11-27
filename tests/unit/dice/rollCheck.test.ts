import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { quietRollResult } from '../../../src/app/online/gm/quietRoll';
import { DiceTool, rollDiceFormula, type DiceRollInputs } from '../../../src/app/tools/DiceTool';
import type { DiceSet } from '../../../src/app/types/diceSetTypes';

const builtIn = (id: string): DiceSet => BUILT_IN_DICE_SETS.find((set) => set.id === id)!;
const d20 = builtIn('builtin:d20');
const underSet: DiceSet = { id: 'under', name: 'Under', builtIn: false, crit: 'roll-under', dice: [{ count: 3, sides: 6 }] };

/** A random source whose dice show `faces` in turn (each the face of a d`sides`). */
function scripted(...faces: Array<[number, number]>): () => number {
  const queue = [...faces];
  return () => {
    const [face, sides] = queue.shift() ?? [1, 2];
    return (face - 0.5) / sides;
  };
}

function toolFor(set: DiceSet, random: () => number): DiceTool {
  const inputs: DiceRollInputs = { random, rollId: () => 'roll', roller: () => 'GM', onFormulaError: vi.fn() };
  return new DiceTool(new EventEmitter(), () => set, inputs);
}

const sixes = (...faces: number[]): Array<[number, number]> => faces.map((face) => [face, 6]);

describe('rolling check text with the dice tool', () => {
  it('judges 3d6 vs 10 under on a roll-under set, by the set direction', () => {
    const win = toolFor(underSet, scripted(...sixes(3, 3, 3))).rollDice('3d6 vs 10')!;
    expect(win.total).toBe(9);
    expect(win.formula).toBe('3d6 vs 10');
    expect(win.check).toMatchObject({ target: 10, direction: 'under', margin: 1, success: true, rule: 'builtin:margin' });
    const loss = toolFor(underSet, scripted(...sixes(4, 4, 4))).rollDice('3d6 vs 10')!;
    expect(loss.check).toMatchObject({ margin: -2, success: false });
  });

  it('judges 1d20+5 vs 15 over on a d20 set', () => {
    const roll = toolFor(d20, scripted([10, 20])).rollDice('1d20+5 vs 15')!;
    expect(roll.total).toBe(15);
    expect(roll.formula).toBe('1d20+5 vs 15');
    expect(roll.check).toMatchObject({ direction: 'over', margin: 0, success: true });
    expect(toolFor(d20, scripted([9, 20])).rollDice('1d20+5 vs 15')!.check).toMatchObject({ margin: -1, success: false });
  });

  it('lets a written ≤ or ≥ override the set direction', () => {
    const under = toolFor(d20, scripted([10, 20])).rollDice('1d20 ≤ 12')!;
    expect(under.formula).toBe('1d20 ≤ 12');
    expect(under.check).toMatchObject({ direction: 'under', margin: 2, success: true });
    const over = toolFor(underSet, scripted(...sixes(5, 5, 5))).rollDice('3d6 ≥ 14')!;
    expect(over.check).toMatchObject({ direction: 'over', margin: 1, success: true });
  });

  it('completes a bonus check with the set dice and keeps the check text', () => {
    const roll = toolFor(d20, scripted([10, 20])).rollDice('+5 vs 15')!;
    expect(roll.formula).toBe('1d20+5 vs 15');
    expect(roll.check?.success).toBe(true);
  });

  it('rolls with advantage and judges the kept total', () => {
    const roll = toolFor(d20, scripted([4, 20], [17, 20])).rollDice('+0 vs 15', undefined, undefined, { advantage: 'advantage' })!;
    expect(roll.total).toBe(17);
    expect(roll.check).toMatchObject({ margin: 2, success: true });
  });

  it('leaves text that is not a check as it was, without a check', () => {
    const roll = toolFor(d20, scripted([10, 20])).rollDice('1d20+5')!;
    expect(roll.check).toBeUndefined();
    expect('check' in roll).toBe(false);
    expect(roll.formula).toBe('1d20+5');
  });

  it('refuses a check whose formula does not parse, naming the error', () => {
    const onFormulaError = vi.fn();
    const refused = rollDiceFormula('d0x vs 5', d20, { random: Math.random, rollId: () => 'r', roller: () => 'GM', onFormulaError });
    expect(refused).toBeNull();
    expect(onFormulaError).toHaveBeenCalledTimes(1);
  });
});

describe('DiceTool.rollCheck', () => {
  it('rolls the formula against the target by the system direction and logs it', () => {
    const tool = toolFor(underSet, scripted(...sixes(2, 2, 2)));
    const roll = tool.rollCheck('3d6', 7)!;
    expect(roll.formula).toBe('3d6 vs 7');
    expect(roll.check).toMatchObject({ direction: 'under', margin: 1, success: true });
    expect(tool.state.rollHistory[0]).toBe(roll);
  });

  it('takes a direction override', () => {
    const roll = toolFor(underSet, scripted(...sixes(2, 2, 2))).rollCheck('3d6', 7, { direction: 'over' })!;
    expect(roll.formula).toBe('3d6 ≥ 7');
    expect(roll.check).toMatchObject({ direction: 'over', margin: -1, success: false });
  });

  it('takes the options of any roll (a set)', () => {
    const roll = toolFor(underSet, scripted([12, 20])).rollCheck('', 10, { set: d20 })!;
    expect(roll.formula).toBe('1d20 vs 10');
    expect(roll.check).toMatchObject({ direction: 'over', margin: 2, success: true });
    expect(roll.diceSet).toEqual({ id: d20.id, name: d20.name });
  });
});

describe('quiet rolls', () => {
  it('carry the same check and fields as a normal roll of the same dice', () => {
    const quiet = quietRollResult('3d6 vs 10', underSet, 'q', 1, scripted(...sixes(3, 4, 5)))!;
    const loud = toolFor(underSet, scripted(...sixes(3, 4, 5))).rollDice('3d6 vs 10')!;
    const { id: _quietId, timestamp: _quietTime, ...quietBody } = quiet;
    const { id: _id, timestamp: _time, player: _player, ...loudBody } = loud;
    expect(quietBody).toEqual(loudBody);
    expect(quiet.check).toMatchObject({ direction: 'under', margin: -2, success: false });
    expect(quiet.crit).toBeDefined();
  });

  it('is still null for empty text and unparsable formulas', () => {
    expect(quietRollResult('  ', d20, 'q', 1)).toBeNull();
    expect(quietRollResult('d0x vs 5', d20, 'q', 1)).toBeNull();
  });
});

describe('rolling with target steps', () => {
  const steps = [{ label: 'Agility', value: 2 }, { label: 'Modifier', value: -1 }];

  it('records how the target of a rolled check was built', () => {
    const roll = toolFor(underSet, scripted(...sixes(3, 3, 3))).rollDice('3d6 vs 16', undefined, undefined, { targetSteps: steps })!;
    expect(roll.formula).toBe('3d6 vs 16');
    expect(roll.check).toMatchObject({ target: 16, baseTarget: 15, targetSteps: steps });
  });

  it('records nothing on a roll that is no check', () => {
    const roll = toolFor(underSet, scripted(...sixes(3, 3, 3))).rollDice('3d6', undefined, undefined, { targetSteps: steps })!;
    expect(roll.check).toBeUndefined();
  });

  it('gives each side of a contest its own steps', () => {
    const tool = toolFor(underSet, scripted(...sixes(3, 3, 3, 3, 3, 3)));
    const [one, two] = tool.rollContest('3d6 vs 16', '3d6 vs 12', { sideSteps: { first: steps } })!;
    expect(one.check).toMatchObject({ baseTarget: 15, targetSteps: steps });
    expect(two.check).not.toHaveProperty('targetSteps');
  });
});
