// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findBlock } from '../../../../src/app/statblocks/model/treeQueries';
import type { StatblockTemplate, TemplateBlock } from '../../../../src/app/statblocks/model/templateTypes';
import { FakeSession, sampleTemplate } from './editorKit';
import { mountEditor, tileOptions } from './sidePanesKit';

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 40, 16);
});
afterAll(() => { MotionGlobalConfig.skipAnimations = false; });
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function withNumbers(): StatblockTemplate {
  const sample = sampleTemplate();
  return {
    ...sample,
    fields: [
      ...sample.fields,
      { key: 'agility', label: 'Agility', type: 'number' },
      { key: 'strength', label: 'Strength', type: 'number' },
      { key: 'experiences', label: 'Experiences', type: 'pairs' },
      { key: 'stats', label: 'Abilities', type: 'scores', slots: ['Str', 'Dex'] },
    ],
    layout: {
      ...sample.layout,
      blocks: [
        ...sample.layout.blocks,
        { id: 'traits01', type: 'metric', heading: 'Traits', fields: ['agility', 'strength'] },
        { id: 'experie1', type: 'pairs', field: 'experiences' },
        { id: 'stats001', type: 'scores', field: 'stats', orientation: 'row' },
      ],
    },
  };
}

const blockOf = (session: FakeSession, id: string): TemplateBlock | undefined => findBlock(session.template.layout.blocks, id)?.block;
const bonusSwitch = (): HTMLElement | null => within(tileOptions()).queryByRole('switch', { name: 'Roll as a bonus' });
const checkSwitch = (): HTMLElement | null => within(tileOptions()).queryByRole('switch', { name: 'Roll as a check' });

describe('Roll as a check in a tile\'s Options', () => {
  it.each(['traits01', 'stat-ac1', 'experie1', 'stats001'])('switches %s on and off, written as rollAs only while on', (id) => {
    const session = new FakeSession(withNumbers());
    const { frame } = mountEditor(session);
    fireEvent.click(frame(id));
    fireEvent.click(checkSwitch()!);
    expect(blockOf(session, id)).toMatchObject({ rollAs: 'check' });
    expect(session.steps).toBe(1);
    fireEvent.click(checkSwitch()!);
    expect(blockOf(session, id)).not.toHaveProperty('rollAs');
    expect(session.steps).toBe(2);
  });

  it('takes the place of Roll as a bonus, and the other way round', () => {
    const session = new FakeSession(withNumbers());
    const { frame } = mountEditor(session);
    fireEvent.click(frame('traits01'));
    fireEvent.click(bonusSwitch()!);
    fireEvent.click(checkSwitch()!);
    expect(blockOf(session, 'traits01')).toMatchObject({ rollAs: 'check' });
    expect(blockOf(session, 'traits01')).not.toHaveProperty('rollable');
    fireEvent.click(bonusSwitch()!);
    expect(blockOf(session, 'traits01')).toMatchObject({ rollable: true });
    expect(blockOf(session, 'traits01')).not.toHaveProperty('rollAs');
  });

  it('is not offered on a Value that holds no number', () => {
    const { frame } = mountEditor(new FakeSession(withNumbers()));
    fireEvent.click(frame('stat-sp1'));
    expect(checkSwitch()).toBeNull();
  });
});
