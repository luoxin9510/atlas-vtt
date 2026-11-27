// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntryParts } from '../../../../src/app/statblocks/editor/template-editor/inspector/EntryParts';
import type { EntryExtraShape, StatblockTemplate, TemplateField } from '../../../../src/app/statblocks/model/templateTypes';
import { FakeSession, sampleTemplate } from './editorKit';
import { renderInEditor } from './sidePanesKit';

afterEach(cleanup);

function attacks(extras: EntryExtraShape[]): TemplateField {
  return { key: 'attacks', label: 'Attacks', type: 'entries', entry: { extras } };
}

function sessionWith(extras: EntryExtraShape[]): FakeSession {
  const sample = sampleTemplate();
  const template: StatblockTemplate = { ...sample, fields: [...sample.fields, attacks(extras)] };
  return new FakeSession(template);
}

const attackField = (session: FakeSession): TemplateField => session.template.fields.find((f) => f.key === 'attacks')!;
const extrasOf = (session: FakeSession): EntryExtraShape[] | undefined => attackField(session).entry?.extras;

/** The parts of the attacks field as the session holds them now, as the inspector reads them. */
function Parts({ session }: { session: FakeSession }): React.JSX.Element {
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <EntryParts fields={[attackField(session)]} session={session} readOnly={false} />;
}

function mount(session: FakeSession): void {
  renderInEditor(session, <Parts session={session} />);
}

describe('Roll as a check on a number extra of an entry', () => {
  it('switches on and off as one step each, written only while on', () => {
    const session = sessionWith([{ key: 'skill', label: 'Skill', type: 'number' }]);
    mount(session);
    fireEvent.click(screen.getByRole('switch', { name: 'Roll as a check' }));
    expect(extrasOf(session)?.[0]).toMatchObject({ key: 'skill', rollAs: 'check' });
    expect(session.steps).toBe(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Roll as a check' }));
    expect(extrasOf(session)?.[0]).not.toHaveProperty('rollAs');
    expect(session.steps).toBe(2);
  });

  it('is offered for number extras only', () => {
    mount(sessionWith([{ key: 'range', label: 'Range', type: 'text' }, { key: 'cost', label: 'Cost', type: 'dice' }]));
    expect(screen.queryByRole('switch', { name: 'Roll as a check' })).toBeNull();
  });
});
