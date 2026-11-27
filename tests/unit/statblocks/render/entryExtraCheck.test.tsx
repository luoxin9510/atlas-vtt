// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDiceSet } from '../../../../src/app/gameSystems/diceSetResolution';
import type { EntryExtraShape, StatblockTemplate, TemplateField } from '../../../../src/app/statblocks/model/templateTypes';
import { blockEl, fakeApp, renderSheet, templateOf } from './sheetTestKit';

vi.mock('../../../../src/app/atlasViewType', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt' }));
vi.mock('../../../../src/app/services/diceSets/collectionDiceSets', async (original) => ({
  ...(await original<typeof import('../../../../src/app/services/diceSets/collectionDiceSets')>()),
  diceSetsOf: () => [{ ...defaultDiceSet(), id: 'under-3d6', name: '3d6 roll-under', dice: [{ count: 3, sides: 6 }], crit: 'roll-under' }],
}));

afterEach(cleanup);

const extras = (skill: Partial<EntryExtraShape>): EntryExtraShape[] => [
  { key: 'skill', label: 'Skill', type: 'number', ...skill },
  { key: 'reach', label: 'Reach', type: 'text', rollAs: 'check' },
];
const field = (skill: Partial<EntryExtraShape>): TemplateField => ({ key: 'attacks', label: 'Attacks', type: 'entries', entry: { extras: extras(skill) } });

/** The template rolls with a 3d6 roll-under set. */
function template(skill: Partial<EntryExtraShape>): StatblockTemplate {
  return { ...templateOf([field(skill)], [{ id: 'attacks1', type: 'entries', field: 'attacks' }]), diceSetId: 'under-3d6' };
}

const ENTRIES = { attacks: [{ name: 'Broadsword', desc: 'Swings.', skill: 15, reach: '12' }] };
const links = (el: Element): string[] => [...el.querySelectorAll<HTMLElement>('.atlas-dice-link')].map((link) => link.dataset.formula ?? '');

describe('a number extra of an entry that rolls as a check', () => {
  it('is one link rolling the set\'s default roll against the number', () => {
    const { container } = renderSheet(template({ rollAs: 'check' }), ENTRIES, { app: fakeApp() });
    expect(links(blockEl(container, 'attacks1')!)).toEqual(['3d6 vs 15']);
  });

  it('rolls a click on the link as that check', () => {
    const rolls: { formula: string; source: unknown }[] = [];
    const { container } = renderSheet(template({ rollAs: 'check' }), ENTRIES, { app: fakeApp(rolls) });
    act(() => { blockEl(container, 'attacks1')!.querySelector<HTMLElement>('.atlas-dice-link')?.click(); });
    expect(rolls.map((roll) => roll.formula)).toEqual(['3d6 vs 15']);
  });

  it('is unchanged where the option is off, and a text extra never rolls', () => {
    const { container } = renderSheet(template({}), ENTRIES, { app: fakeApp() });
    expect(links(blockEl(container, 'attacks1')!)).toEqual([]);
  });
});
