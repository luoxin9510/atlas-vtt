// @vitest-environment jsdom
import React, { useContext } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { OffMapRoller } from '../../src/app/services/offMapRoller';
import { provideGmOnlySwitch } from '../../src/app/services/gmOnlySwitch';
import type { OffMapRolls } from '../../src/app/services/statblockRolls';
import { PaneDiceRolls } from '../../src/app/statblocks/editor/statblock-pane/PaneDiceRolls';
import { OffMapRollsContext } from '../../src/app/statblocks/render/shared/offMapRolls';

vi.mock('../../src/app/services/diceSets/collectionDiceSets', () => ({
  diceSetOfCollection: vi.fn(() => BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20-roll-under')),
}));
vi.mock('../../src/app/react/components/dice/DiceRollDisplay', () => ({ DiceRollDisplay: (): null => null }));
vi.mock('../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));

/** The off-map roller the pane gives the statblocks drawn inside it, for the switch's value. */
function paneRoller(on: boolean): OffMapRolls {
  const app = {} as never;
  provideGmOnlySwitch(app, () => on);
  let roller: OffMapRolls | null = null;
  const Probe = (): null => {
    roller = useContext(OffMapRollsContext);
    return null;
  };
  render(<PaneDiceRolls app={app} collectionId={null}><Probe /></PaneDiceRolls>);
  return roller!;
}

const source = { type: 'statblock' } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the rolls of a statblock beside its note, with no map open', () => {
  it('are hidden while the GM-only switch is on: a roll and both sides of a contest', () => {
    const pane = paneRoller(true);
    expect(pane.roll('1d20 vs 12', source)?.hidden).toBe(true);
    expect(pane.roll('1d20 vs 12', source, { visibility: 'all' })?.hidden).toBeUndefined();
    const sides = pane.rollContest!('3d6 vs 12', '3d6 vs 14', [source, source]);
    expect(sides?.map((side) => side.hidden)).toEqual([true, true]);
  });

  it('are open while the switch is off', () => {
    const pane = paneRoller(false);
    expect(pane.roll('1d20 vs 12', source)?.hidden).toBeUndefined();
    expect(pane.rollContest!('3d6 vs 12', '3d6 vs 14', [source, source])?.map((side) => side.hidden)).toEqual([undefined, undefined]);
  });
});

describe('a contest of a statblock beside its note', () => {
  it('rolls neither side where the second is refused', () => {
    const random = vi.spyOn(Math, 'random');
    const pane = paneRoller(false);
    expect(pane.rollContest!('3d6 vs 12', 'nonsense vs 14', [source, source])).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });
});

describe('a roll the pane shows itself, with no map open', () => {
  it('is announced to the roller for the log and the online table, as displayed, but not when a map made it', () => {
    const app = {} as never;
    const roller = OffMapRoller.forApp(app);
    const heard: Array<{ formula: string; displayed: boolean | undefined; doc: Document }> = [];
    roller.onRoll((rolled) => heard.push({ formula: rolled.result.formula, displayed: rolled.displayed, doc: rolled.doc }));
    let pane: OffMapRolls | null = null;
    const Probe = (): null => {
      pane = useContext(OffMapRollsContext);
      return null;
    };
    render(<PaneDiceRolls app={app} collectionId={null}><Probe /></PaneDiceRolls>);
    const rolled = pane!.roll('1d20', source)!;
    pane!.show(rolled, false);
    pane!.show(rolled, true);
    expect(heard).toEqual([{ formula: '1d20', displayed: true, doc: document }]);
    expect(roller.history()).toHaveLength(1);
  });
});
