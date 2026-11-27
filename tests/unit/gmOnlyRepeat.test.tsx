// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DICE_RULES } from '../../src/app/gameSystems/diceRules';
import { useDiceHistory } from '../../src/app/react/components/dice-log/useDiceHistory';
import { DiceTool } from '../../src/app/tools/DiceTool';

describe('repeating a roll from the dice log', () => {
  it('keeps a GM-only roll GM-only, and an open roll open', () => {
    const bus = new EventEmitter();
    const tool = new DiceTool(bus, () => DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'repeat', roller: () => 'GM', onFormulaError: vi.fn() });
    const log = { diceLog: [], addDiceLogEntry: vi.fn(), clearDiceLog: vi.fn() };
    const { result } = renderHook(() => useDiceHistory(() => tool, log, bus));

    act(() => result.current.repeatRoll('1d20', undefined, undefined, true));
    act(() => result.current.repeatRoll('1d20'));

    expect(result.current.history.map((roll) => roll.hidden)).toEqual([undefined, true]);
  });

  it('repeats a roll GM-only while the GM-only switch is on, and in the open while it is off', () => {
    for (const [on, hidden] of [[true, true], [false, undefined]] as const) {
      const bus = new EventEmitter();
      const tool = new DiceTool(bus, () => DEFAULT_DICE_RULES, { random: () => 0.5, rollId: () => 'repeat', roller: () => 'GM', onFormulaError: vi.fn(), gmOnly: () => on });
      const log = { diceLog: [], addDiceLogEntry: vi.fn(), clearDiceLog: vi.fn() };
      const { result } = renderHook(() => useDiceHistory(() => tool, log, bus));

      act(() => result.current.repeatRoll('1d20'));
      act(() => result.current.repeatRoll('1d20', undefined, 'advantage'));
      act(() => result.current.repeatContest(tool.rollDice('1d20 vs 12')!, tool.rollDice('1d20 vs 14')!));

      expect(result.current.history.length).toBeGreaterThan(0);
      expect(result.current.history.map((roll) => roll.hidden)).toEqual(result.current.history.map(() => hidden));
    }
  });
});

describe('repeating a contest from the dice log', () => {
  it('rolls each side with the advantage it was rolled with', () => {
    const rollContest = vi.fn(() => null);
    const tool = { rollDice: vi.fn(), rollContest, clearHistory: vi.fn() };
    const log = { diceLog: [], addDiceLogEntry: vi.fn(), clearDiceLog: vi.fn() };
    const { result } = renderHook(() => useDiceHistory(() => tool, log, new EventEmitter()));
    const side = (formula: string, advantage?: 'advantage' | 'disadvantage'): never => ({ formula, ...(advantage && { advantage }) }) as never;
    act(() => result.current.repeatContest(side('1d20 vs 12'), side('1d20 vs 14', 'advantage')));
    expect(rollContest).toHaveBeenCalledWith('1d20 vs 12', '1d20 vs 14', expect.objectContaining({ sideAdvantage: { second: 'advantage' } }));
    expect(rollContest.mock.calls[0]![2]).not.toHaveProperty('advantage');
  });
});
