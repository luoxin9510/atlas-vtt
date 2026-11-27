import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerContestRule } from '../../../src/app/dice/contestRules';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { DiceTool, type DiceRollInputs } from '../../../src/app/tools/DiceTool';
import type { DiceRollResult } from '../../../src/app/types/diceTypes';
import type { DiceSet } from '../../../src/app/types/diceSetTypes';

const d20 = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')!;
const underSet: DiceSet = { id: 'under', name: 'Under', builtIn: false, crit: 'roll-under', dice: [{ count: 3, sides: 6 }] };

/** A random source whose dice show `faces` in turn (each the face of a d`sides`). */
function scripted(...faces: Array<[number, number]>): () => number {
  const queue = [...faces];
  return () => {
    const [face, sides] = queue.shift() ?? [1, 2];
    return (face - 0.5) / sides;
  };
}
const sixes = (...faces: number[]): Array<[number, number]> => faces.map((face) => [face, 6]);

function setup(set: DiceSet, random: () => number): { tool: DiceTool; bus: EventEmitter; onFormulaError: ReturnType<typeof vi.fn> } {
  const bus = new EventEmitter();
  const onFormulaError = vi.fn();
  let n = 0;
  const inputs: DiceRollInputs = { random, rollId: () => `id-${++n}`, roller: () => 'GM', onFormulaError };
  return { tool: new DiceTool(bus, () => set, inputs), bus, onFormulaError };
}

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((undo) => undo()));

describe('DiceTool.rollContest', () => {
  it('rolls both sides as checks, first then second, sharing a contest id and a verdict on the second', () => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const pair = tool.rollContest('3d6 vs 12', '3d6 vs 14')!;
    const [first, second] = pair;
    expect(first.formula).toBe('3d6 vs 12');
    expect(second.formula).toBe('3d6 vs 14');
    expect(first.total).toBe(9);
    expect(second.total).toBe(12);
    expect(first.check).toMatchObject({ margin: 3, success: true });
    expect(second.check).toMatchObject({ margin: 2, success: true });
    expect(first.contest).toEqual({ id: expect.any(String), side: 'first' });
    expect(second.contest).toEqual({ id: first.contest!.id, side: 'second', verdict: { winner: 'first', rule: 'builtin:contest-margin' } });
    expect(first.id).not.toBe(second.id);
    expect(first.contest!.id).not.toBe(first.id);
    expect(first.contest).not.toHaveProperty('verdict');
  });

  it('completes a bare target with the set default roll', () => {
    const { tool } = setup(underSet, scripted(...sixes(2, 2, 2, 5, 5, 5)));
    const [first, second] = tool.rollContest('12', '14')!;
    expect(first.formula).toBe('3d6 vs 12');
    expect(second.formula).toBe('3d6 vs 14');
    expect(second.contest!.verdict).toEqual({ winner: 'first', rule: 'builtin:contest-margin' });
  });

  it('completes a bare bonus side with the set dice, as a check does', () => {
    const { tool } = setup(d20, scripted([10, 20], [4, 20]));
    const [first, second] = tool.rollContest('+5 vs 15', '12')!;
    expect(first.formula).toBe('1d20+5 vs 15');
    expect(second.formula).toBe('1d20 vs 12');
    expect(second.contest!.verdict).toEqual({ winner: 'first', rule: 'builtin:contest-margin' });
  });

  it('gives a tie where the margins are equal', () => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3, 3, 3, 3)));
    const [, second] = tool.rollContest('12', '12')!;
    expect(second.contest!.verdict).toEqual({ winner: null, rule: 'builtin:contest-margin' });
  });

  it('carries the names, where given, on both sides', () => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const [first, second] = tool.rollContest('12', '14', { names: { first: 'Ana', second: 'Bo' } })!;
    expect(first.contest!.names).toEqual({ first: 'Ana', second: 'Bo' });
    expect(second.contest!.names).toEqual({ first: 'Ana', second: 'Bo' });
  });

  it('uses the contest rule the set names', () => {
    cleanup.push(registerContestRule('test:second', () => ({ winner: 'second' })));
    const { tool } = setup({ ...underSet, contestRule: 'test:second' }, scripted(...sixes(1, 1, 1, 6, 6, 6)));
    const [, second] = tool.rollContest('12', '14')!;
    expect(second.contest!.verdict).toEqual({ winner: 'second', rule: 'test:second' });
  });

  it('records two rolls as two normal rolls: history and dice-rolled events, first then second', () => {
    const { tool, bus } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const seen: DiceRollResult[] = [];
    bus.on('dice-rolled', (result: DiceRollResult) => seen.push(result));
    const [first, second] = tool.rollContest('12', '14', { set: underSet })!;
    expect(seen).toEqual([first, second]);
    expect(seen[0]).toBe(first);
    expect(tool.state.rollHistory.slice(0, 2)).toEqual([second, first]);
  });

  it('passes the origin and source of a roll along to both, via rollDice', () => {
    const { tool, bus } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const origins: unknown[] = [];
    bus.on('dice-rolled', (_result: DiceRollResult, origin: unknown) => origins.push(origin));
    const origin = { tokenId: 't1' } as never;
    tool.rollDice('12 对 14', { type: 'toolbar' }, origin);
    expect(origins).toEqual([origin, origin]);
    expect(tool.state.rollHistory.slice(0, 2).map((roll) => roll.source)).toEqual([{ type: 'toolbar' }, { type: 'toolbar' }]);
  });

  it('marks both rolls hidden for a GM-only contest', () => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const [first, second] = tool.rollContest('12', '14', { visibility: 'gm' })!;
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(true);
    const [openFirst, openSecond] = tool.rollContest('12', '14')!;
    expect(openFirst).not.toHaveProperty('hidden');
    expect(openSecond).not.toHaveProperty('hidden');
  });

  it('rolls a side with a set of its own', () => {
    const { tool } = setup(underSet, scripted([12, 20], [8, 20]));
    const [first, second] = tool.rollContest('10', '10', { set: d20 })!;
    expect(first.formula).toBe('1d20 vs 10');
    expect(first.diceSet).toEqual({ id: d20.id, name: d20.name });
    expect(second.contest!.verdict!.winner).toBe('first');
  });

  it('rolls nothing, recording nothing, where a side is no check', () => {
    const { tool, bus } = setup(underSet, scripted());
    const seen = vi.fn();
    bus.on('dice-rolled', seen);
    expect(tool.rollContest('abc', '14')).toBeNull();
    expect(tool.rollContest('12', '1d20+5')).toBeNull();
    expect(seen).not.toHaveBeenCalled();
    expect(tool.state.rollHistory).toEqual([]);
  });

  it('rolls nothing where the second side refuses its formula, reporting the error', () => {
    const { tool, bus, onFormulaError } = setup(underSet, scripted());
    const seen = vi.fn();
    bus.on('dice-rolled', seen);
    expect(tool.rollContest('12', '999d999 vs 5')).toBeNull();
    expect(onFormulaError).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    expect(tool.state.rollHistory).toEqual([]);
  });
});

describe('DiceTool.rollContest validates both sides before rolling either', () => {
  it('consumes no randoms and no ids where the second side refuses its formula', () => {
    const random = vi.fn(() => 0.5);
    const { tool, onFormulaError } = setup(underSet, random);
    expect(tool.rollContest('3d6 vs 12', '999d999 vs 5')).toBeNull();
    expect(random).not.toHaveBeenCalled();
    expect(onFormulaError).toHaveBeenCalledTimes(1);
    expect(tool.state.rollHistory).toEqual([]);
    const next = tool.rollContest('12', '14')!;
    expect(next[0].id).toBe('id-1');
  });

  it('consumes no randoms where the first side refuses its formula', () => {
    const random = vi.fn(() => 0.5);
    const { tool, onFormulaError } = setup(underSet, random);
    expect(tool.rollContest('999d999 vs 5', '12')).toBeNull();
    expect(random).not.toHaveBeenCalled();
    expect(onFormulaError).toHaveBeenCalledTimes(1);
  });
});

describe('DiceTool.rollDice with contest text', () => {
  it.each(['12 对 14', '12对14', '12 against 14', '12 AGAINST 14'])('rolls %j as a contest and returns the second result', (text) => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3, 4, 4, 4)));
    const result = tool.rollDice(text)!;
    expect(result.formula).toBe('3d6 vs 14');
    expect(result.contest).toMatchObject({ side: 'second', verdict: { winner: 'first' } });
    expect(tool.state.rollHistory).toHaveLength(2);
    expect(tool.state.rollHistory[1]!.contest).toMatchObject({ side: 'first', id: result.contest!.id });
  });

  it('rolls full check sides', () => {
    const { tool } = setup(d20, scripted([10, 20], [15, 20]));
    const result = tool.rollDice('1d20+5 vs 15 对 1d20 vs 10')!;
    expect(result.contest!.verdict).toEqual({ winner: 'second', rule: 'builtin:contest-margin' });
  });

  it('still rolls 12 vs 14 as one plain check', () => {
    const { tool } = setup(underSet, scripted(...sixes(3, 3, 3)));
    const result = tool.rollDice('3d6 vs 14')!;
    expect(result).not.toHaveProperty('contest');
    expect(tool.state.rollHistory).toHaveLength(1);
  });

  it('keeps contest text out of the plain-formula path (a formula is no contest)', () => {
    const { tool } = setup(d20, scripted([10, 20]));
    const result = tool.rollDice('1d20+5')!;
    expect(result).not.toHaveProperty('contest');
  });
});
