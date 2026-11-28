import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { RulePacks } from '../../../src/app/rulePacks/rulePackApi';
import { provideGmOnlySwitch, gmOnlySwitchOf } from '../../../src/app/services/gmOnlySwitch';
import { DiceTool } from '../../../src/app/tools/DiceTool';

vi.mock('../../../src/app/services/diceSets/collectionDiceSets', () => ({
  diceSetOfCollection: vi.fn(() => BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')),
}));

const d20 = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')!;

let on = false;
/** The GM's switch, as the settings of the apps made after it say. */
function switchIs(value: boolean): void {
  on = value;
}

/** An app with no map open. */
function noMap(): never {
  const app = { workspace: { getLeavesOfType: () => [], trigger: vi.fn() } };
  provideGmOnlySwitch(app as never, () => on);
  return app as never;
}

/** An app with a map open, whose real dice tool reads the same switch. */
function withMap(): never {
  const app = { workspace: {} };
  provideGmOnlySwitch(app as never, () => on);
  const tool = new DiceTool(new EventEmitter(), () => d20, {
    random: () => 0.5, rollId: () => 'id', roller: () => 'GM', onFormulaError: vi.fn(), gmOnly: gmOnlySwitchOf(app as never),
  });
  const view = { containerEl: {}, serviceManager: { getToolController: () => ({ getDiceTool: () => tool }) } };
  Object.assign(app.workspace, { getLeavesOfType: () => [{ view }], trigger: vi.fn() });
  return app as never;
}

beforeEach(() => {
  // The off-map roller names the focused window; Obsidian provides it
  vi.stubGlobal('activeDocument', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rule pack rolls while the GM-only switch is on', () => {
  it('hide a roll, a check and a contest that name no visibility, with no map open', () => {
    switchIs(true);
    const api = new RulePacks(noMap());
    expect(api.rollDice('1d20')?.hidden).toBe(true);
    expect(api.rollCheck('1d20', 12)?.hidden).toBe(true);
    expect(api.rollContest('1d20 vs 12', '1d20 vs 14')?.map((side) => side.hidden)).toEqual([true, true]);
  });

  it('hide a check with a map open, whose dice tool decides', () => {
    switchIs(true);
    expect(new RulePacks(withMap()).rollCheck('1d20', 12)?.hidden).toBe(true);
  });

  it('stay open where the pack forces visibility all, with or without a map', () => {
    switchIs(true);
    for (const app of [noMap(), withMap()]) {
      const api = new RulePacks(app);
      expect(api.rollDice('1d20', { visibility: 'all' })?.hidden).toBeUndefined();
      expect(api.rollCheck('1d20', 12, { visibility: 'all' })?.hidden).toBeUndefined();
      expect(api.rollContest('1d20 vs 12', '1d20 vs 14', { visibility: 'all' })?.map((side) => side.hidden)).toEqual([undefined, undefined]);
    }
  });

  it('change nothing while the switch is off', () => {
    switchIs(false);
    for (const app of [noMap(), withMap()]) {
      const api = new RulePacks(app);
      expect(api.rollCheck('1d20', 12)?.hidden).toBeUndefined();
      expect(api.rollContest('1d20 vs 12', '1d20 vs 14')?.map((side) => side.hidden)).toEqual([undefined, undefined]);
    }
  });
});
