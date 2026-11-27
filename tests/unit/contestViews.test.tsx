// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DiceToast } from '../../src/app/react/components/dice/DiceToast';
import { DiceContestEntry } from '../../src/app/react/components/dice-log/DiceContestEntry';
import { useDiceHistory } from '../../src/app/react/components/dice-log/useDiceHistory';
import { groupContests } from '../../src/app/dice/contestGroups';
import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { DiceTool } from '../../src/app/tools/DiceTool';
import type { RollContest } from '../../src/app/dice/contestTypes';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

vi.mock('../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

function side(id: string, contest: RollContest, total: number, margin: number): DiceRollResult {
  return {
    id, timestamp: 0, formula: '1d20 vs 10', rolls: [{ die: 'd20', value: total, max: 20 }], modifiers: 0, total, contest,
    check: { target: 10, direction: 'over', margin, success: margin >= 0, crit: null, rule: 'margin' },
  };
}
const NAMES = { first: 'Ana', second: 'Bo' };
const FIRST = side('a', { id: 'c', side: 'first', names: NAMES }, 15, 5);
const SECOND = side('b', { id: 'c', side: 'second', names: NAMES, verdict: { winner: 'first', rule: 'builtin:contest-margin' } }, 12, 2);

describe('contests in card mode', () => {
  const card = (result: DiceRollResult): HTMLElement =>
    render(<DiceToast result={result} presentation={null} phase="visible" onDismiss={() => undefined} useAvatar={() => null} />).container;

  it('puts the verdict on the second card only, each card keeping its check line', () => {
    const second = card(SECOND);
    expect(second.querySelector('.atlas-contest-verdict')?.textContent).toBe('Ana wins');
    expect(second.querySelector('.atlas-check-line')?.textContent).toBe('Success by 2');
    const first = card(FIRST);
    expect(first.querySelector('.atlas-contest-verdict')).toBeNull();
    expect(first.querySelector('.atlas-check-line')?.textContent).toBe('Success by 5');
  });
});

describe('groupContests', () => {
  const PLAIN: DiceRollResult = { id: 'p', timestamp: 0, formula: '1d20', rolls: [], modifiers: 0, total: 5 };
  const contestOf = (roll: DiceRollResult): RollContest | undefined => roll.contest;

  it('makes the two rolls of a contest one group where the other rolls stay single, in place', () => {
    expect(groupContests([SECOND, PLAIN, FIRST], contestOf)).toEqual([
      { kind: 'contest', first: FIRST, second: SECOND },
      { kind: 'roll', roll: PLAIN },
    ]);
  });

  it('keeps a side whose partner is not in the list as a plain roll', () => {
    expect(groupContests([SECOND, PLAIN], contestOf)).toEqual([{ kind: 'roll', roll: SECOND }, { kind: 'roll', roll: PLAIN }]);
  });

  it('does not join sides of different contests', () => {
    const other = side('x', { id: 'other', side: 'first' }, 3, 0);
    expect(groupContests([SECOND, other], contestOf).every((group) => group.kind === 'roll')).toBe(true);
  });
});

describe('the dice log entry of a contest', () => {
  it('shows both rolls with their check lines and the verdict, as one entry', () => {
    const onRepeat = vi.fn();
    const { container } = render(<DiceContestEntry first={FIRST} second={SECOND} onRepeat={onRepeat} />);
    expect(container.querySelectorAll('.dice-log-entry')).toHaveLength(1);
    expect(container.textContent).toContain('Ana');
    expect(container.textContent).toContain('Bo');
    expect([...container.querySelectorAll('.atlas-check-line')].map((line) => line.textContent)).toEqual(['Success by 5', 'Success by 2']);
    expect(container.querySelector('.atlas-contest-verdict')?.textContent).toBe('Ana wins');
    fireEvent.click(container.querySelector('.dice-log-entry__repeat')!);
    expect(onRepeat).toHaveBeenCalledTimes(1);
  });
});

describe('repeating a contest from the dice log', () => {
  const d20 = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')!;

  function setup(): { result: { current: ReturnType<typeof useDiceHistory> } } {
    const bus = new EventEmitter();
    let n = 0;
    const tool = new DiceTool(bus, () => d20, { random: () => 0.5, rollId: () => `id-${++n}`, roller: () => 'GM', onFormulaError: vi.fn() });
    const log = { diceLog: [], addDiceLogEntry: vi.fn(), clearDiceLog: vi.fn() };
    return renderHook(() => useDiceHistory(() => tool, log, bus));
  }

  it('rolls the contest again, with the same names, as a new pair with its own id', () => {
    const { result } = setup();
    act(() => result.current.repeatContest(FIRST, SECOND));
    const [second, first] = result.current.history;
    expect(first!.contest).toMatchObject({ side: 'first', names: NAMES });
    expect(second!.contest).toMatchObject({ side: 'second', names: NAMES });
    expect(first!.contest!.id).toBe(second!.contest!.id);
    expect(first!.contest!.id).not.toBe('c');
    expect(first!.formula).toBe('1d20 vs 10');
  });

  it('keeps a GM-only contest GM-only', () => {
    const { result } = setup();
    act(() => result.current.repeatContest({ ...FIRST, hidden: true }, { ...SECOND, hidden: true }));
    expect(result.current.history.map((roll) => roll.hidden)).toEqual([true, true]);
  });
});
