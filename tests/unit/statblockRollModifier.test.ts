// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));

import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { attachDiceRolling, linkDiceIn, type RollChoice } from '../../src/app/services/statblockDiceLinks';
import { ArmedBonuses } from '../../src/app/statblocks/rollBonuses/armedBonuses';
import { bonusId } from '../../src/app/statblocks/rollBonuses/armableValues';
import { parseModifier } from '../../src/app/tools/targetModifier';
import type { RollingDice } from '../../src/app/types/diceSetTypes';

const under = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20-roll-under')!;
const over = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')!;

afterEach(() => { document.body.replaceChildren(); });

function mapApp(rules: RollingDice) {
  const formulas: string[] = [];
  const diceTool = {
    rollDice: (formula: string) => { formulas.push(formula); return { formula } as never; },
    rollingDice: () => rules,
  };
  const app = {
    workspace: { getLeavesOfType: () => [{ view: { serviceManager: { getToolController: () => ({ getDiceTool: () => diceTool }) } } }] },
    vault: { getFileByPath: () => null },
  } as never;
  return { app, formulas };
}

/** A statblock line holding `text`, wired for rolling; returns what its right-click menu offers. */
function setup(text: string, rules: RollingDice, bonuses?: { key: string; armable: Map<string, { label: string; value: number }> }) {
  const { app, formulas } = mapApp(rules);
  const el = document.createElement('div');
  el.textContent = text;
  document.body.append(el);
  linkDiceIn(el);
  const openMenu = vi.fn<(choices: readonly RollChoice[]) => void>();
  attachDiceRolling(el, app, () => ({ bonuses }), undefined, undefined, openMenu);
  const link = el.querySelector<HTMLElement>('.atlas-dice-link')!;
  link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  const choices = openMenu.mock.lastCall?.[0] ?? [];
  return { app, formulas, choices, modifierChoice: choices.find((choice) => choice.label === 'Roll with a modifier…') };
}

const dialog = (): HTMLElement | null => document.querySelector('.atlas-text-dialog');
const field = (): HTMLInputElement => document.querySelector<HTMLInputElement>('.atlas-text-dialog__input')!;
async function type(text: string, key = 'Enter'): Promise<void> {
  field().value = text;
  field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve));
}

/** A check link inside a hit-points line, with a hit-points handler wired. */
function hitPointsSetup(text: string, rules: RollingDice): { choices: readonly RollChoice[]; formulas: string[]; hitPoints: string[]; link: HTMLElement } {
  const { app, formulas } = mapApp(rules);
  const el = document.createElement('div');
  el.innerHTML = '<span data-hit-points></span>';
  el.querySelector('span')!.textContent = text;
  document.body.append(el);
  linkDiceIn(el);
  const hitPoints: string[] = [];
  const openMenu = vi.fn<(choices: readonly RollChoice[]) => void>();
  attachDiceRolling(el, app, () => ({}), (formula) => { hitPoints.push(formula); }, undefined, openMenu);
  const link = el.querySelector<HTMLElement>('.atlas-dice-link')!;
  link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
  return { choices: openMenu.mock.lastCall?.[0] ?? [], formulas, hitPoints, link };
}

describe('a check link on a hit-points line', () => {
  it('rolls as a check, never as hit points, and offers the modifier', () => {
    const { choices, formulas, hitPoints, link } = hitPointsSetup('3d6 vs 12', under);
    expect(choices.map((choice) => choice.label)).toContain('Roll with a modifier…');
    link.click();
    expect(hitPoints).toEqual([]);
    expect(formulas).toEqual(['3d6 vs 12']);
  });

  it('still sends plain hit dice to the hit-points roll', () => {
    const { choices, formulas, hitPoints, link } = hitPointsSetup('3d6+2', under);
    expect(choices).toEqual([]);
    link.click();
    expect(hitPoints).toEqual(['3d6+2']);
    expect(formulas).toEqual([]);
  });
});

describe('a modifier for a named roll', () => {
  it('keeps the names of the formula it changed', async () => {
    const { app, formulas } = mapApp(over);
    const el = document.createElement('div');
    el.textContent = '1d20+1 vs 15';
    document.body.append(el);
    linkDiceIn(el);
    const openMenu = vi.fn<(choices: readonly RollChoice[]) => void>();
    const namedRolls = new Map([['1d20+1 vs 15', '1d20+1[Agility] vs 15']]);
    attachDiceRolling(el, app, () => ({ namedRolls }), undefined, undefined, openMenu);
    el.querySelector('.atlas-dice-link')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    openMenu.mock.lastCall![0].find((choice) => choice.label === 'Roll with a modifier…')!.roll();
    await type('+2');
    expect(formulas).toEqual(['1d20+1[Agility]+2 vs 15']);
  });
});

describe('a modifier dialog that outlives its statblock', () => {
  it('rolls nothing when it is confirmed after the link\'s cleanup ran', async () => {
    const { app, formulas } = mapApp(under);
    const el = document.createElement('div');
    el.textContent = '3d6 vs 15';
    document.body.append(el);
    linkDiceIn(el);
    const openMenu = vi.fn<(choices: readonly RollChoice[]) => void>();
    const cleanup = attachDiceRolling(el, app, () => ({}), undefined, undefined, openMenu);
    el.querySelector('.atlas-dice-link')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    openMenu.mock.lastCall![0].find((choice) => choice.label === 'Roll with a modifier…')!.roll();
    cleanup();
    await type('-2');
    expect(formulas).toEqual([]);
  });
});

describe('parseModifier', () => {
  it('reads a signed or bare whole number and nothing else', () => {
    expect(parseModifier('-2')).toBe(-2);
    expect(parseModifier(' +3 ')).toBe(3);
    expect(parseModifier('3')).toBe(3);
    for (const bad of ['', '+', '2.5', 'two', '1d4', '--1']) expect(parseModifier(bad)).toBeNull();
  });
});

describe('Roll with a modifier', () => {
  it('is offered on a check link only', () => {
    expect(setup('3d6 vs 15', under).modifierChoice).toBeDefined();
    expect(setup('1d20+2 ≥ 15', over).modifierChoice).toBeDefined();
    expect(setup('2d8+2', over).modifierChoice).toBeUndefined();
    expect(setup('+4', over).modifierChoice).toBeUndefined();
  });

  it('moves the target of an under check: -2 on 3d6 vs 15 rolls 3d6 vs 13', async () => {
    const { modifierChoice, formulas } = setup('3d6 vs 15', under);
    modifierChoice!.roll();
    expect(formulas).toEqual([]);
    await type('-2');
    expect(formulas).toEqual(['3d6 vs 13']);
    expect(dialog()).toBeNull();
  });

  it('adds to the dice of an over check: +2 on 1d20 vs 15 rolls 1d20+2 vs 15', async () => {
    const { modifierChoice, formulas } = setup('1d20 vs 15', over);
    modifierChoice!.roll();
    await type('+2');
    expect(formulas).toEqual(['1d20+2 vs 15']);
  });

  it('shares the rule with armed bonuses: armed +1 and modifier -2 on under rolls 3d6 vs 14', async () => {
    const key = 'note:Mira.md';
    const armable = new Map([[bonusId('proficiency'), { label: 'Proficiency', value: 1 }]]);
    const { app, modifierChoice, formulas } = setup('3d6 vs 15', under, { key, armable });
    ArmedBonuses.forApp(app).toggle(key, bonusId('proficiency'));
    modifierChoice!.roll();
    await type('-2');
    expect(formulas).toEqual(['3d6 vs 14']);
  });

  it('rejects input that is no whole number, shows why, and rolls nothing', async () => {
    const { modifierChoice, formulas } = setup('3d6 vs 15', under);
    modifierChoice!.roll();
    await type('two');
    expect(formulas).toEqual([]);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('.atlas-text-dialog__error')?.textContent).toBe('Enter a whole number such as -2 or +3.');
    await type('');
    expect(formulas).toEqual([]);
    await type('3');
    expect(formulas).toEqual(['3d6 vs 18']);
  });

  it('is cancelled by Escape without a roll, and remembers nothing', async () => {
    const { modifierChoice, formulas } = setup('3d6 vs 15', under);
    modifierChoice!.roll();
    await type('-2', 'Escape');
    expect(formulas).toEqual([]);
    expect(dialog()).toBeNull();
    modifierChoice!.roll();
    expect(field().value).toBe('');
  });
});
