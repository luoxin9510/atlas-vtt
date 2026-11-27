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
});
