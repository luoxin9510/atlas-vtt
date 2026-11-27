import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { rollStatblockContest, rollStatblockDice } from '../../src/app/services/statblockRolls';
import { DiceTool } from '../../src/app/tools/DiceTool';

const under = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20-roll-under')!;

/** An open map whose real dice tool belongs to a GM whose GM-only switch is `gmOnly`. */
function mapWith(gmOnly: boolean): never {
  let ids = 0;
  const tool = new DiceTool(new EventEmitter(), () => under, { random: () => 0.5, rollId: () => `id-${(ids += 1)}`, roller: () => 'GM', onFormulaError: vi.fn(), gmOnly: () => gmOnly });
  const view = { containerEl: { isShown: () => true }, serviceManager: { getToolController: () => ({ getDiceTool: () => tool }) } };
  return { workspace: { getLeavesOfType: () => [{ view }] }, vault: { getFileByPath: () => null } } as never;
}

describe('statblock rolls made on a map', () => {
  it('are all hidden while the GM-only switch is on: a link roll, a roll with a modifier, both sides of a contest', () => {
    const app = mapWith(true);
    expect(rollStatblockDice(app, '1d20', {})?.hidden).toBe(true);
    const modified = rollStatblockDice(app, '1d20 vs 12', { targetSteps: [{ label: 'Modifier', value: 2 }] });
    expect(modified?.hidden).toBe(true);
    const sides = rollStatblockContest(app, { formula: '3d6 vs 12', source: {} }, { formula: '3d6 vs 14', source: {} });
    expect(sides?.map((side) => side.hidden)).toEqual([true, true]);
  });

  it('are open while the switch is off', () => {
    const app = mapWith(false);
    expect(rollStatblockDice(app, '1d20', {})).not.toHaveProperty('hidden');
    const sides = rollStatblockContest(app, { formula: '3d6 vs 12', source: {} }, { formula: '3d6 vs 14', source: {} });
    expect(sides?.map((side) => side.hidden)).toEqual([undefined, undefined]);
  });
});
