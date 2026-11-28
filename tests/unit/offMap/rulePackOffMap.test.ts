import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { RulePacks } from '../../../src/app/rulePacks/rulePackApi';
import { provideGmOnlySwitch } from '../../../src/app/services/gmOnlySwitch';
import { OffMapRoller, type OffMapRolled } from '../../../src/app/services/offMapRoller';

const asked: Array<string | null> = [];
vi.mock('../../../src/app/services/diceSets/collectionDiceSets', () => ({
  diceSetOfCollection: (_app: unknown, id: string | null) => {
    asked.push(id);
    return BUILT_IN_DICE_SETS.find((set) => set.id === (id === 'goblins' ? 'builtin:power-roll' : 'builtin:d20'));
  },
}));
vi.mock('../../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));

/** An app with no map open (or with one whose dice tool rolls `mapResult`), and what its off-map roller announced. */
function setup(gmOnly = false, mapResult?: unknown): { api: RulePacks; announced: OffMapRolled[] } {
  const leaves = mapResult === undefined ? [] : [{ view: { containerEl: {}, serviceManager: { getToolController: () => ({ getDiceTool: () => ({ rollDice: () => mapResult, rollCheck: () => mapResult }) }) } } }];
  const app = { workspace: { getLeavesOfType: () => leaves, trigger: vi.fn() } } as never;
  provideGmOnlySwitch(app, () => gmOnly);
  const announced: OffMapRolled[] = [];
  OffMapRoller.forApp(app).onRoll((rolled) => announced.push(rolled));
  return { api: new RulePacks(app), announced };
}

beforeEach(() => {
  // The off-map roller names the focused window; Obsidian provides it
  vi.stubGlobal('activeDocument', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  asked.length = 0;
});

describe('rule pack rolls with no map open go through the off-map roller', () => {
  it('rollDice is announced and returns the roll', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { api, announced } = setup();
    const result = api.rollDice('1d20+1');
    expect(result).toMatchObject({ total: 12, formula: '1d20+1' });
    expect(announced.map((rolled) => rolled.result)).toEqual([result]);
  });

  it('rollCheck is announced with its verdict', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { api, announced } = setup();
    const result = api.rollCheck('1d20', 11, { direction: 'under' });
    expect(result?.check).toMatchObject({ target: 11, direction: 'under', success: true });
    expect(announced.map((rolled) => rolled.result)).toEqual([result]);
  });

  it('rollContest announces both sides and returns them', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { api, announced } = setup();
    const pair = api.rollContest('1d20 vs 15', '1d20 vs 9', { names: { first: 'Ann', second: 'Bo' } });
    expect(pair).toHaveLength(2);
    expect(announced.map((rolled) => rolled.result)).toEqual(pair);
    expect(pair?.[1].contest?.verdict).toMatchObject({ winner: 'second' });
  });

  it('contest text through rollDice announces both sides and returns the second', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { api, announced } = setup();
    const result = api.rollDice('12 对 14');
    expect(result?.contest).toMatchObject({ side: 'second' });
    expect(announced).toHaveLength(2);
    expect(announced[1]?.result).toBe(result);
  });

  it('a formula it refuses announces nothing', () => {
    const { api, announced } = setup();
    expect(api.rollDice('not dice')).toBeNull();
    expect(api.rollContest('nonsense', '12')).toBeNull();
    expect(announced).toEqual([]);
  });

  it('keeps GM-only: hidden by the switch or by the pack, open where the pack says all', () => {
    const closed = setup(true);
    expect(closed.api.rollDice('1d20')?.hidden).toBe(true);
    expect(closed.api.rollDice('1d20', { visibility: 'all' })?.hidden).toBeUndefined();
    expect(closed.announced.map((rolled) => rolled.result.hidden)).toEqual([true, undefined]);
    const open = setup(false);
    expect(open.api.rollCheck('1d20', 10, { visibility: 'gm' })?.hidden).toBe(true);
    expect(open.api.rollContest('1d20 vs 12', '1d20 vs 12', { visibility: 'gm' })?.map((side) => side.hidden)).toEqual([true, true]);
  });

  it('rolls with the dice set of collectionId, else the default', () => {
    const { api } = setup();
    expect(api.rollDice('+3', { collectionId: 'goblins' })?.rolls).toHaveLength(2);
    expect(api.rollDice('+3')?.rolls).toHaveLength(1);
    expect(asked).toContain('goblins');
  });

  it('announces nothing while a map is open: the map\'s dice tool rolls', () => {
    const { api, announced } = setup(false, { id: 'map', total: 9 });
    expect(api.rollDice('2d6')?.id).toBe('map');
    expect(api.rollCheck('1d20', 12)?.id).toBe('map');
    expect(announced).toEqual([]);
  });
});
