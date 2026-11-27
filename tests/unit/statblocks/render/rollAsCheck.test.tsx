// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatblockTemplate, TemplateBlock, TemplateField } from '../../../../src/app/statblocks/model/templateTypes';
import { blockEl, fakeApp, renderSheet, templateOf } from './sheetTestKit';

vi.mock('../../../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));

afterEach(cleanup);

const FIELDS: TemplateField[] = [
  { key: 'dx', label: 'DX', type: 'text' },
  { key: 'iq', label: 'IQ', type: 'text' },
  { key: 'ht', label: 'HT', type: 'text' },
];
const BLOCK: TemplateBlock = { id: 'attrs001', type: 'metric', heading: 'Attributes', fields: ['dx', 'iq', 'ht'], rollAs: 'check' };

/** The template rolls with the d20 roll-under set, whose default roll is `1d20`. */
const checks = (block: TemplateBlock = BLOCK): StatblockTemplate => ({ ...templateOf(FIELDS, [block]), diceSetId: 'builtin:d20-roll-under' });

function links(el: Element): string[] {
  return [...el.querySelectorAll<HTMLElement>('.atlas-dice-link')].map((link) => link.dataset.formula ?? '');
}

describe('a block that rolls as a check', () => {
  it('links the leading number of each value as the set\'s default roll against it, and nothing else', () => {
    const { container } = renderSheet(checks(), { dx: '15 (DX+2)', iq: '—', ht: '12' }, { app: fakeApp() });
    expect(links(blockEl(container, 'attrs001')!)).toEqual(['1d20 vs 15', '1d20 vs 12']);
  });

  it('rolls a click on the link as that check', () => {
    const rolls: { formula: string; source: unknown }[] = [];
    const { container } = renderSheet(checks(), { dx: '15', iq: '', ht: '' }, { app: fakeApp(rolls) });
    act(() => { blockEl(container, 'attrs001')!.querySelector<HTMLElement>('.atlas-dice-link')?.click(); });
    expect(rolls.map((roll) => roll.formula)).toEqual(['1d20 vs 15']);
  });

  it('leaves a block that rolls as a bonus rolling the number as a bonus', () => {
    const bonus: TemplateBlock = { id: 'attrs001', type: 'metric', heading: 'Attributes', fields: ['dx', 'iq', 'ht'], rollable: true };
    const { container } = renderSheet(checks(bonus), { dx: '15', iq: '', ht: '12' }, { app: fakeApp() });
    expect(links(blockEl(container, 'attrs001')!)).toEqual(['+15', '+12']);
  });
});
