import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import type { DiceSet } from '../../../src/app/types/diceSetTypes';

const sets = vi.hoisted(() => ({ asked: [] as Array<string | null> }));
vi.mock('../../../src/app/services/diceSets/collectionDiceSets', () => ({
  diceSetOfCollection: (_app: unknown, id: string | null): DiceSet => {
    sets.asked.push(id);
    const wanted = id === 'goblins' ? 'builtin:power-roll' : 'builtin:d20';
    return BUILT_IN_DICE_SETS.find((set) => set.id === wanted)!;
  },
}));
vi.mock('../../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));

import { provideGmOnlySwitch } from '../../../src/app/services/gmOnlySwitch';
import { OffMapRoller } from '../../../src/app/services/offMapRoller';

const doc = { name: 'main' } as unknown as Document;
const otherDoc = { name: 'popout' } as unknown as Document;

function rollerFor(gmOnly = false): OffMapRoller {
  const app = {} as never;
  provideGmOnlySwitch(app, () => gmOnly);
  return OffMapRoller.forApp(app);
}

afterEach(() => { sets.asked.length = 0; });

describe('the off-map roller: which dice set rolls', () => {
  it('uses the set of the collection the note is in', () => {
    const roller = rollerFor();
    const result = roller.roll('+3', { notePath: 'atlas-vtt/collections/goblins/Chief.md', doc });
    expect(sets.asked).toEqual(['goblins']);
    expect(result?.rolls.length).toBe(2);
  });

  it('uses the library default for a note outside any collection', () => {
    const roller = rollerFor();
    const result = roller.roll('+3', { notePath: 'Notes/Chief.md', doc });
    expect(sets.asked).toEqual([null]);
    expect(result?.rolls.length).toBe(1);
  });

  it('prefers the set a template names', () => {
    const roller = rollerFor();
    const powerRoll = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:power-roll')!;
    const result = roller.roll('+3', { notePath: 'Notes/Chief.md', set: powerRoll, doc });
    expect(result?.rolls.length).toBe(2);
  });
});

describe('the off-map roller: who sees a roll', () => {
  it('hides a roll while the GM-only switch is on, unless it names everyone', () => {
    const roller = rollerFor(true);
    expect(roller.roll('1d20', { doc })?.hidden).toBe(true);
    expect(roller.roll('1d20', { doc, visibility: 'all' })?.hidden).toBeUndefined();
  });

  it('leaves a roll open while the switch is off', () => {
    expect(rollerFor(false).roll('1d20', { doc })?.hidden).toBeUndefined();
  });
});

describe('the off-map roller: contests', () => {
  it('rolls both sides through the contest builder, hidden together', () => {
    const roller = rollerFor(true);
    const pair = roller.rollContest('3d6 vs 12', '3d6 vs 14', { doc });
    expect(pair?.map((side) => side.hidden)).toEqual([true, true]);
  });

  it('rolls neither side where one is refused', () => {
    const random = vi.spyOn(Math, 'random');
    expect(rollerFor().rollContest('3d6 vs 12', 'nonsense vs 14', { doc })).toBeNull();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe('the off-map roller: what it announces', () => {
  it('emits each result with the document it was rolled in', () => {
    const roller = rollerFor();
    const heard: Array<{ formula: string; doc: Document }> = [];
    roller.onRoll((rolled) => heard.push({ formula: rolled.result.formula, doc: rolled.doc }));
    roller.roll('1d20', { doc });
    roller.roll('1d6', { doc: otherDoc });
    expect(heard).toEqual([{ formula: '1d20', doc }, { formula: '1d6', doc: otherDoc }]);
  });

  it('emits both sides of a contest', () => {
    const roller = rollerFor();
    const heard: string[] = [];
    roller.onRoll((rolled) => heard.push(rolled.result.formula));
    roller.rollContest('3d6 vs 12', '3d6 vs 14', { doc });
    expect(heard).toHaveLength(2);
  });

  it('stops telling a listener that left', () => {
    const roller = rollerFor();
    const heard: string[] = [];
    const off = roller.onRoll((rolled) => heard.push(rolled.result.formula));
    off();
    roller.roll('1d20', { doc });
    expect(heard).toEqual([]);
  });

  it('keeps the last 20 results in memory, newest last', () => {
    const roller = rollerFor();
    for (let i = 1; i <= 25; i++) roller.roll(`1d20+${i}`, { doc });
    const kept = roller.history();
    expect(kept).toHaveLength(20);
    expect(kept[0]?.result.formula).toBe('1d20+6');
    expect(kept[19]?.result.formula).toBe('1d20+25');
  });

  it('tells nobody of a roll it refused', () => {
    const roller = rollerFor();
    const heard: unknown[] = [];
    roller.onRoll((rolled) => heard.push(rolled));
    expect(roller.roll('nonsense', { doc })).toBeNull();
    expect(heard).toEqual([]);
  });
});
