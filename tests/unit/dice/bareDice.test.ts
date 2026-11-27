import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { quietRollResult } from '../../../src/app/online/gm/quietRoll';
import { DiceTool, rollDiceFormula, type DiceRollInputs } from '../../../src/app/tools/DiceTool';
import type { DiceSet } from '../../../src/app/types/diceSetTypes';

const sixSet: DiceSet = { id: 'six', name: 'Six', builtIn: false, crit: 'natural', dice: [{ count: 1, sides: 6 }], bareDie: true };
const plainSet: DiceSet = { id: 'plain', name: 'Plain', builtIn: false, crit: 'natural', dice: [{ count: 1, sides: 6 }] };

/** A random source whose d6 show `faces` in turn. */
function scripted(...faces: number[]): () => number {
  const queue = [...faces];
  return () => ((queue.shift() ?? 1) - 0.5) / 6;
}

function inputsFor(random: () => number): DiceRollInputs {
  return { random, rollId: () => 'roll', roller: () => 'GM', onFormulaError: vi.fn() };
}

const toolFor = (set: DiceSet, random: () => number): DiceTool => new DiceTool(new EventEmitter(), () => set, inputsFor(random));

describe('rolling dice written without faces', () => {
  it('refuses them when the set does not opt in', () => {
    const inputs = inputsFor(scripted(3));
    expect(rollDiceFormula('1d+2', plainSet, inputs)).toBeNull();
    expect(inputs.onFormulaError).toHaveBeenCalledTimes(1);
    expect(toolFor(plainSet, scripted(3)).rollDice('2d-1')).toBeNull();
  });

  it('rolls them as the first die of a set that opts in, keeping the formula as written', () => {
    const roll = toolFor(sixSet, scripted(3)).rollDice('1d+2')!;
    expect(roll.formula).toBe('1d+2');
    expect(roll.total).toBe(5);
    const two = toolFor(sixSet, scripted(4, 5)).rollDice('2d-1')!;
    expect(two.formula).toBe('2d-1');
    expect(two.total).toBe(8);
    expect(two.rolls[0]).toMatchObject({ die: 'd6' });
  });

  it('reads them in a check and in a quiet roll', () => {
    const check = toolFor(sixSet, scripted(3)).rollDice('1d+2 vs 5')!;
    expect(check.formula).toBe('1d+2 vs 5');
    expect(check.check).toMatchObject({ target: 5, success: true });
    expect(toolFor(sixSet, scripted(3)).rollCheck('1d+2', 5)!.total).toBe(5);
    expect(quietRollResult('1d+2', sixSet, 'id', 0, scripted(3))!.total).toBe(5);
    expect(quietRollResult('1d+2', plainSet, 'id', 0, scripted(3))).toBeNull();
  });

  it('leaves faces, percent and fate as written with the option on', () => {
    expect(toolFor(sixSet, scripted(4)).rollDice('1d6')!.total).toBe(4);
    expect(toolFor(sixSet, () => 0.5).rollDice('1d%')!.rolls[0]).toMatchObject({ die: 'd100' });
    expect(toolFor(sixSet, () => 0.5).rollDice('4dF')!.rolls).toHaveLength(4);
    expect(toolFor(sixSet, () => 0.5).rollDice('d20')!.rolls[0]).toMatchObject({ die: 'd20' });
  });
});
