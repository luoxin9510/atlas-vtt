import { describe, expect, it } from 'vitest';
import { IMPORT_RECORD_KEY, readImportRecord, withImportRecord, type ImportRecord } from '../../../src/app/importers/importRecord';
import { applyFrontmatterPatches } from '../../../src/app/statblocks/notes/frontmatterPatch';
import { frontmatterOfText } from '../../../src/app/statblocks/notes/statblockSource';
import { autoTemplate } from '../../../src/app/statblocks/model/autoTemplate';
import { isReservedKey } from '../../../src/app/statblocks/model/reservedKeys';
import { resolveNative } from '../../../src/app/statblocks/resolve/resolveStatblock';

const RECORD: ImportRecord = { importer: 'pack:gcs', source: '/Users/me/Characters/Robin.gcs', keys: ['name', 'hp', 'skills'] };

describe('import record', () => {
  it('is written under one key and read back', () => {
    const written = withImportRecord({ name: 'Robin', hp: 10 }, RECORD);
    expect(written[IMPORT_RECORD_KEY]).toEqual(RECORD);
    expect(readImportRecord(written)).toEqual(RECORD);
  });

  it('leaves the frontmatter it was given untouched and keeps the other keys', () => {
    const before = { name: 'Robin', hp: 10 };
    const written = withImportRecord(before, RECORD);
    expect(before).toEqual({ name: 'Robin', hp: 10 });
    expect(written).toMatchObject({ name: 'Robin', hp: 10 });
  });

  it('replaces an earlier record, and copies the keys so later changes do not reach it', () => {
    const keys = ['a'];
    const first = withImportRecord({}, { importer: 'x', source: '/a', keys });
    keys.push('b');
    expect(readImportRecord(first)?.keys).toEqual(['a']);
    const second = withImportRecord(first, RECORD);
    expect(readImportRecord(second)).toEqual(RECORD);
  });

  it('reads an empty key list', () => {
    expect(readImportRecord(withImportRecord({}, { importer: 'x', source: '/a', keys: [] }))?.keys).toEqual([]);
  });

  it('reads an empty source: a file whose path the host could not tell is asked for again on re-import', () => {
    expect(readImportRecord({ atlasImport: { importer: 'x', source: '', keys: ['hp'] } })).toEqual({ importer: 'x', source: '', keys: ['hp'] });
  });

  it.each([
    ['no record', {}],
    ['no frontmatter', null],
    ['undefined', undefined],
    ['a string', { atlasImport: 'x' }],
    ['a list', { atlasImport: [] }],
    ['no importer', { atlasImport: { source: '/a', keys: [] } }],
    ['an empty importer', { atlasImport: { importer: '', source: '/a', keys: [] } }],
    ['a non-string importer', { atlasImport: { importer: 3, source: '/a', keys: [] } }],
    ['no source', { atlasImport: { importer: 'x', keys: [] } }],
    ['a non-string source', { atlasImport: { importer: 'x', source: 4, keys: [] } }],
    ['no keys', { atlasImport: { importer: 'x', source: '/a' } }],
    ['keys that are not a list', { atlasImport: { importer: 'x', source: '/a', keys: 'hp' } }],
    ['a key that is not a string', { atlasImport: { importer: 'x', source: '/a', keys: ['hp', 4] } }],
  ])('reads %s as no record', (_name, frontmatter) => {
    expect(readImportRecord(frontmatter as never)).toBeNull();
  });

  it('survives a trip through the note text and a patch of another field', () => {
    const text = [
      '---', 'statblock: true', 'atlas-template: t', 'name: Robin', 'hp: 10',
      'atlasImport:', '  importer: pack:gcs', '  source: /Users/me/Characters/Robin.gcs', '  keys:', '    - name', '    - hp', '---', 'Body', '',
    ].join('\n');
    expect(readImportRecord(frontmatterOfText(text))).toEqual({ importer: 'pack:gcs', source: '/Users/me/Characters/Robin.gcs', keys: ['name', 'hp'] });
    const result = applyFrontmatterPatches(text, [{ op: 'set', path: ['hp'], base: 10, next: 7 }]);
    expect(result.text).toContain('hp: 7');
    expect(result.text).toContain('atlasImport:\n  importer: pack:gcs');
    expect(readImportRecord(frontmatterOfText(result.text))).toEqual({ importer: 'pack:gcs', source: '/Users/me/Characters/Robin.gcs', keys: ['name', 'hp'] });
  });
});

describe('a statblock note that carries an import record', () => {
  const frontmatter = withImportRecord({ statblock: true, 'atlas-template': 'gone', name: 'Robin', hp: 10 }, RECORD);

  it('has a reserved key, so no template field binds it', () => {
    expect(isReservedKey(IMPORT_RECORD_KEY)).toBe(true);
  });

  it('is a field of no auto template', () => {
    const shown = autoTemplate({ name: 'Robin', hp: 10, [IMPORT_RECORD_KEY]: RECORD }).fields.map((field) => field.key);
    expect(shown).toEqual(['name', 'hp']);
  });

  it('shows no field for it under a missing template, and still resolves the values', () => {
    const resolved = resolveNative('Robin.md', { kind: 'atlas', templateId: 'gone' }, frontmatter, new Map() as never);
    expect(resolved.template?.fields.map((field) => field.key)).toEqual(['name', 'hp']);
    expect(resolved.fields).toMatchObject({ name: 'Robin', hp: 10 });
  });
});
