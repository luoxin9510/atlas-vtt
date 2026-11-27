// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));
const hide = vi.hoisted(() => vi.fn());
const showNotice = vi.hoisted(() => vi.fn((_message: string, _duration?: number) => ({ hide })));
vi.mock('../../src/app/ui/notice', () => ({ showNotice }));

import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { attachDiceRolling, linkDiceIn, type RollChoice } from '../../src/app/services/statblockDiceLinks';
import type { DiceRollSource } from '../../src/app/services/statblockRolls';
import { cancelPendingContest } from '../../src/app/services/pendingContest';
import { ArmedBonuses } from '../../src/app/statblocks/rollBonuses/armedBonuses';
import { bonusId } from '../../src/app/statblocks/rollBonuses/armableValues';
import type { RollingDice } from '../../src/app/types/diceSetTypes';

const under = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20-roll-under')!;
const START = 'Start a contest…';

afterEach(() => {
  cancelPendingContest();
  document.body.replaceChildren();
  showNotice.mockClear();
  hide.mockClear();
});

function mapApp(rules: RollingDice) {
  const rolled: string[] = [];
  const contests: unknown[][] = [];
  const diceTool = {
    rollDice: (formula: string) => { rolled.push(formula); return { formula } as never; },
    rollContest: (...args: unknown[]) => { contests.push(args); return [{}, {}] as never; },
    rollingDice: () => rules,
  };
  const app = {
    workspace: { getLeavesOfType: () => [{ view: { serviceManager: { getToolController: () => ({ getDiceTool: () => diceTool }) } } }] },
    vault: { getFileByPath: () => null },
  } as never;
  return { app, rolled, contests };
}

/** A statblock card holding `text`, wired for rolling; its one link and a function that opens its menu. */
function card(app: never, text: string, source: DiceRollSource = {}) {
  const el = document.createElement('div');
  el.textContent = text;
  document.body.append(el);
  linkDiceIn(el);
  const openMenu = vi.fn<(choices: readonly RollChoice[]) => void>();
  const cleanup = attachDiceRolling(el, app, () => source, undefined, undefined, openMenu);
  const link = el.querySelector<HTMLElement>('.atlas-dice-link')!;
  const menu = (): readonly RollChoice[] => {
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    return openMenu.mock.lastCall?.[0] ?? [];
  };
  const startContest = (): void => { menu().find((choice) => choice.label === START)!.roll(); };
  return { el, link, menu, startContest, cleanup };
}

/** The listeners of a pending contest are armed a tick after it starts, so the click that chose it is not its answer. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
const press = (key: string): void => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };

describe('starting a contest from a check link', () => {
  it('offers it on check links only', () => {
    const { app } = mapApp(under);
    expect(card(app, '3d6 vs 12').menu().map((choice) => choice.label)).toContain(START);
    expect(card(app, '2d6+3').menu().map((choice) => choice.label)).not.toContain(START);
  });

  it('waits with a hint, then rolls one contest with the next check link clicked, naming both sides', async () => {
    const { app, rolled, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12', { tokenName: 'Goblin' });
    const ogre = card(app, '3d6 vs 14', { tokenName: 'Ogre' });
    goblin.startContest();
    expect(showNotice).toHaveBeenCalledOnce();
    expect(showNotice.mock.calls[0]![0]).toBe('Click the opponent\'s check to roll the contest. Press Esc to cancel.');
    expect(showNotice.mock.calls[0]![1]).toBe(0);
    await tick();
    ogre.link.click();
    expect(contests).toMatchObject([['3d6 vs 12', '3d6 vs 14', { names: { first: 'Goblin', second: 'Ogre' } }]]);
    // Each side keeps its own source, so the map's log names both tokens as a single roll does
    expect(contests[0]![2]).toMatchObject({ sides: { first: { source: { type: 'statblock', tokenName: 'Goblin' } }, second: { source: { type: 'statblock', tokenName: 'Ogre' } } } });
    expect(rolled).toEqual([]);
    expect(hide).toHaveBeenCalledOnce();
    // The contest is done: the next click rolls as usual
    goblin.link.click();
    expect(rolled).toEqual(['3d6 vs 12']);
  });

  it('rolls the second side with the advantage of the click that answered, the first as it was started', async () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    ogre.link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    expect(contests[0]![2]).toMatchObject({ sideAdvantage: { second: 'advantage' } });
  });

  // Decisions 7 and 21: while the GM-only switch is on, any roll the GM makes is GM-only. The map's dice tool
  // decides that (`DiceRollInputs.gmOnly`, see statblockGmOnlyRolls.test.ts), so a contest started from links
  // names no visibility of its own: an explicit one would override the switch.
  it('names no visibility, leaving it to the map\'s dice tool and its GM-only switch', async () => {
    const { app, rolled, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    ogre.link.click();
    expect(contests[0]![2]).not.toHaveProperty('visibility');
    expect(rolled).toEqual([]);
  });

  it('names a side without a token by its statblock note', async () => {
    const { app, contests } = mapApp(under);
    const first = card(app, '3d6 vs 12', { statblockPath: 'Bestiary/Goblin.md' });
    const second = card(app, '3d6 vs 14');
    first.startContest();
    await tick();
    second.link.click();
    expect(contests[0]![2]).toMatchObject({ names: { first: 'Goblin' } });
  });

  it('applies the armed bonuses of each side as a normal click would', async () => {
    const { app, contests } = mapApp(under);
    const key = 'note:Ogre.md';
    const armable = new Map([[bonusId('proficiency'), { label: 'Proficiency', value: 1 }]]);
    const first = card(app, '3d6 vs 12');
    const second = card(app, '3d6 vs 15', { bonuses: { key, armable } });
    ArmedBonuses.forApp(app).toggle(key, bonusId('proficiency'));
    first.startContest();
    await tick();
    second.link.click();
    expect(contests[0]!.slice(0, 2)).toEqual(['3d6 vs 12', '3d6 vs 16']);
    expect(ArmedBonuses.forApp(app).armed(key)).toEqual([]);
  });

  it('is cancelled by Escape', async () => {
    const { app, rolled, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    press('Escape');
    expect(hide).toHaveBeenCalledOnce();
    ogre.link.click();
    expect(contests).toEqual([]);
    expect(rolled).toEqual(['3d6 vs 14']);
  });

  it('is cancelled, with no roll, by a click on a dice link that is no check, which rolls nothing', async () => {
    const { app, rolled, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const damage = card(app, '2d6+3');
    goblin.startContest();
    await tick();
    damage.link.click();
    expect(contests).toEqual([]);
    expect(rolled).toEqual([]);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('is cancelled by a click on nothing at all', async () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    document.body.click();
    expect(hide).toHaveBeenCalledOnce();
    ogre.link.click();
    expect(contests).toEqual([]);
  });

  it('is cancelled by the same link clicked again', async () => {
    const { app, rolled, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    goblin.startContest();
    await tick();
    goblin.link.click();
    expect(contests).toEqual([]);
    expect(rolled).toEqual([]);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('is not answered by the click that chose it', () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    goblin.startContest();
    document.body.click();
    expect(hide).not.toHaveBeenCalled();
    expect(contests).toEqual([]);
  });

  it('is cleared when the card it started on is cleaned up', async () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    goblin.cleanup();
    expect(hide).toHaveBeenCalledOnce();
    ogre.link.click();
    expect(contests).toEqual([]);
  });

  it('is cleared by cancelPendingContest, as at unload', async () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    cancelPendingContest();
    expect(hide).toHaveBeenCalledOnce();
    ogre.link.click();
    expect(contests).toEqual([]);
  });

  it('starting another contest replaces the one waiting', async () => {
    const { app, contests } = mapApp(under);
    const goblin = card(app, '3d6 vs 12');
    const ogre = card(app, '3d6 vs 14');
    goblin.startContest();
    await tick();
    ogre.startContest();
    expect(hide).toHaveBeenCalledOnce();
    await tick();
    goblin.link.click();
    expect(contests).toMatchObject([['3d6 vs 14', '3d6 vs 12', {}]]);
  });
});
