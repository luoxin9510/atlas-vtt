// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { MarkdownRenderer } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDiceSet } from '../../../../src/app/gameSystems/diceSetResolution';
import type { TemplateField } from '../../../../src/app/statblocks/model/templateTypes';
import React from 'react';
import { render } from '@testing-library/react';
import { linkDiceIn } from '../../../../src/app/services/statblockDiceLinks';
import { sheetState } from '../../../../src/app/statblocks/render/sheetState';
import { SheetContext } from '../../../../src/app/statblocks/render/sheetContext';
import { DiceText } from '../../../../src/app/statblocks/render/shared/DiceText';
import { blockEl, fakeApp, renderSheet, templateOf } from './sheetTestKit';

vi.mock('../../../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));
vi.mock('../../../../src/app/services/diceSets/collectionDiceSets', async (original) => ({
  ...(await original<typeof import('../../../../src/app/services/diceSets/collectionDiceSets')>()),
  diceSetsOf: () => [{ ...defaultDiceSet(), id: 'bare-d6', name: 'Bare', dice: [{ count: 1, sides: 6 }], bareDie: true }],
}));

const FIELDS: TemplateField[] = [
  { key: 'damage', label: 'Damage', type: 'dice' },
  { key: 'hp', label: 'Hit Points', type: 'number' },
  { key: 'hit_dice', label: 'Hit Dice', type: 'dice' },
  { key: 'notes', label: 'Notes', type: 'text' },
];
const BLOCKS = [
  { id: 'damage00', type: 'stat' as const, field: 'damage', look: 'run-in' as const },
  { id: 'hp000000', type: 'stat' as const, field: 'hp', look: 'run-in' as const, rollFrom: 'hit_dice' },
  { id: 'notes000', type: 'stat' as const, field: 'notes', look: 'run-in' as const },
];
const OPTED_IN = { ...templateOf(FIELDS, BLOCKS), diceSetId: 'bare-d6' };
const PLAIN = templateOf(FIELDS, BLOCKS);
const RECORD = { damage: '1d+1', hp: 5, hit_dice: '2d+1', notes: 'Bites for 1d+2 damage.' };

beforeEach(() => {
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation((_app, markdown, el) => {
    el.insertAdjacentHTML('beforeend', `<p>${markdown}</p>`);
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const formulas = (container: HTMLElement, id: string): string[] =>
  [...(blockEl(container, id)?.querySelectorAll<HTMLElement>('.atlas-dice-link') ?? [])].map((link) => link.dataset.formula ?? '');
const chips = (container: HTMLElement, id: string): number => blockEl(container, id)?.querySelectorAll('.atlas-sb-misfit').length ?? 0;

describe('StatblockSheet with a template set that opts in to bare dice', () => {

  it('links dice written without faces, takes them in a Dice field and rolls hit points from them', () => {
    const { container } = renderSheet(OPTED_IN, RECORD, { app: fakeApp() });
    expect(formulas(container, 'damage00')).toEqual(['1d+1']);
    expect(formulas(container, 'notes000')).toEqual(['1d+2']);
    expect(formulas(container, 'hp000000')).toEqual(['2d+1']);
    expect(chips(container, 'damage00')).toBe(0);
  });

  it('leaves them as text, with the chip, where the set does not opt in', () => {
    const { container } = renderSheet(PLAIN, RECORD, { app: fakeApp() });
    expect(formulas(container, 'damage00')).toEqual([]);
    expect(formulas(container, 'notes000')).toEqual([]);
    expect(formulas(container, 'hp000000')).toEqual([]);
    expect(chips(container, 'damage00')).toBe(1);
  });
});

describe('DiceText inside a sheet', () => {
  it.each([[6, ['1d+2']], [undefined, []]])('links bare dice by the sheet faces (%s)', (defaultFaces, expected) => {
    const state = sheetState({ template: PLAIN, record: {}, mode: 'view', defaultFaces });
    const { container } = render(
      <SheetContext.Provider value={{ state, app: undefined, sourcePath: undefined }}><DiceText text="Bites for 1d+2" /></SheetContext.Provider>,
    );
    expect([...container.querySelectorAll<HTMLElement>('[data-formula]')].map((link) => link.dataset.formula)).toEqual(expected);
  });
});

describe('linkDiceIn with the faces of a statblock', () => {
  it.each([[6, ['1d+2']], [undefined, []]])('links bare dice only where faces are given (%s)', (defaultFaces, expected) => {
    const el = document.createElement('div');
    el.textContent = 'Bites for 1d+2';
    linkDiceIn(el, defaultFaces);
    expect([...el.querySelectorAll<HTMLElement>('.atlas-dice-link')].map((link) => link.dataset.formula)).toEqual(expected);
  });
});
