import { describe, expect, it } from 'vitest';
import { importPatches } from '../../../src/app/importers/importNotePatches';
import { readImportRecord } from '../../../src/app/importers/importRecord';
import { applyFrontmatterPatches } from '../../../src/app/statblocks/notes/frontmatterPatch';
import { frontmatterOfText, TEMPLATE_KEY } from '../../../src/app/statblocks/notes/statblockSource';
import { statblockNoteText } from '../../../src/app/statblocks/notes/createStatblockNote';
import { withImportRecord } from '../../../src/app/importers/importRecord';
import type { FieldValue } from '../../../src/app/statblocks/model/templateTypes';

const BODY = '\n## My notes\n\nRobin owes the guild 20 gold.\n';

function note(): string {
  const base = statblockNoteText({ name: 'Robin', templateId: 'tpl', body: BODY, values: { hp: 10, skills: ['Axe', 'Bow'], luck: 3, mine: 'keep me' } });
  const record = { importer: 'pack:gcs', source: '/old/Robin.gcs', keys: ['hp', 'skills', 'luck'] };
  const frontmatter = frontmatterOfText(base) ?? {};
  const patch = applyFrontmatterPatches(base, [{ op: 'set', path: ['atlasImport'], base: undefined, next: withImportRecord({}, record).atlasImport as FieldValue }]);
  expect(frontmatter.hp).toBe(10);
  return patch.text;
}

describe('writing a re-import into the note', () => {
  it('replaces and removes imported keys only, records the new source and keeps template, other keys and body', () => {
    const text = note();
    const model = frontmatterOfText(text) as Record<string, FieldValue>;
    const patches = importPatches(model, { hp: 12, skills: ['Bow', 'Shield'] }, ['luck'], { importer: 'pack:gcs', source: '/new/Robin.gcs', keys: ['hp', 'skills'] });
    const result = applyFrontmatterPatches(text, patches);
    expect(result.conflicts).toEqual([]);
    const written = frontmatterOfText(result.text);
    expect(written).toMatchObject({ hp: 12, skills: ['Bow', 'Shield'], mine: 'keep me', name: 'Robin', [TEMPLATE_KEY]: 'tpl' });
    expect(written).not.toHaveProperty('luck');
    expect(readImportRecord(written)).toEqual({ importer: 'pack:gcs', source: '/new/Robin.gcs', keys: ['hp', 'skills'] });
    expect(result.text.endsWith(BODY)).toBe(true);
  });

  it('never writes the template, marker, name or image keys, even when the file gives them', () => {
    const text = note();
    const model = frontmatterOfText(text) as Record<string, FieldValue>;
    const patches = importPatches(model, { [TEMPLATE_KEY]: 'other', statblock: false, name: 'X', image: 'y.png', hp: 11 }, [], { importer: 'pack:gcs', source: '', keys: ['hp'] });
    const written = frontmatterOfText(applyFrontmatterPatches(text, patches).text);
    expect(written).toMatchObject({ [TEMPLATE_KEY]: 'tpl', statblock: true, name: 'Robin', hp: 11 });
    expect(written).not.toHaveProperty('image');
  });
});
