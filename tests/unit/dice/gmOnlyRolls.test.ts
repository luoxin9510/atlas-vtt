import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DICE_RULES } from '../../../src/app/gameSystems/diceRules';
import { DiceTool } from '../../../src/app/tools/DiceTool';
import type { DiceRollResult } from '../../../src/app/types/diceTypes';

function setup(): { tool: DiceTool; heard: DiceRollResult[] } {
  const bus = new EventEmitter();
  const heard: DiceRollResult[] = [];
  bus.on('dice-rolled', (result: DiceRollResult) => heard.push(result));
  const tool = new DiceTool(bus, () => DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'roll', roller: () => 'GM', onFormulaError: vi.fn() });
  return { tool, heard };
}

describe('GM-only rolls of the dice tool', () => {
  it('marks a roll made with GM visibility as hidden, and still logs and announces it for the GM', () => {
    const { tool, heard } = setup();
    const result = tool.rollDice('1d20', undefined, undefined, { visibility: 'gm' });
    expect(result?.hidden).toBe(true);
    expect(tool.getState().rollHistory[0]).toBe(result);
    expect(heard).toEqual([result]);
  });

  it('leaves a roll open to all unmarked', () => {
    const { tool } = setup();
    expect(tool.rollDice('1d20')).not.toHaveProperty('hidden');
    expect(tool.rollDice('1d20', undefined, undefined, { visibility: 'all' })).not.toHaveProperty('hidden');
  });

  it('marks a check made with GM visibility, keeping its verdict', () => {
    const { tool } = setup();
    const result = tool.rollCheck('1d20', 10, { visibility: 'gm' });
    expect(result?.hidden).toBe(true);
    expect(result?.check).toBeDefined();
  });
});
