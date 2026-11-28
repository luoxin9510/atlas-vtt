import { afterEach, describe, expect, it } from 'vitest';
import type { PickedFile } from '../../../src/app/importers/characterFiles';
import type { ImportChange } from '../../../src/app/importers/importDiff';
import { reimportCharacter, type ReimportDeps, type ReimportOptions } from '../../../src/app/importers/reimportCharacter';
import type { CharacterImporter, ImportedCharacter } from '../../../src/app/importers/importerTypes';
import type { ImportRecord } from '../../../src/app/importers/importRecord';
import type { FieldValue } from '../../../src/app/statblocks/model/templateTypes';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

const NOTE = 'atlas-vtt/collections/crew/characters/Robin.md';
const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).buffer;
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]).buffer;
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]).buffer;

const file = (path: string | null = '/chars/Robin.gcs'): PickedFile => ({ path, fileName: 'Robin.gcs', bytes: new ArrayBuffer(1) });
const character = (values: Record<string, FieldValue>, portrait?: ArrayBuffer): ImportedCharacter => ({
  name: 'Robin', templateId: 'other-template', values, ...(portrait && { portrait: { bytes: portrait } }),
});
const importerOf = (parse: CharacterImporter['parse']): CharacterImporter => ({ id: 'pack:gcs', label: 'Test', extensions: ['gcs'], parse });

interface Harness {
  deps: ReimportDeps;
  notices: string[];
  confirms: Array<{ name: string; changes: ImportChange[]; portrait: boolean }>;
  edits: Array<{ set: Record<string, FieldValue>; remove: string[]; record: ImportRecord }>;
  images: Array<{ name: string; bytes: ArrayBuffer }>;
  swaps: Array<{ oldImage: string; newImage: string }>;
  newTokens: Array<{ name: string; imagePath: string; collection: string; notePath: string }>;
  placed: Array<{ notePath: string; after: Record<string, FieldValue>; removed: string[]; oldImage: string | null; newImage: string | null }>;
  asked: ImportRecord[];
}

interface Setup {
  frontmatter?: Record<string, FieldValue> | null;
  linkedImage?: string | null;
  oldBytes?: ArrayBuffer | null;
  confirm?: boolean;
  picked?: PickedFile | null;
}

const RECORD: FieldValue = { importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills', 'luck'] };
const NOTE_FRONTMATTER: Record<string, FieldValue> = {
  statblock: true, 'atlas-template': 'tpl', name: 'Robin', hp: 10, skills: ['Axe', 'Bow'], luck: 3, mine: 'keep', atlasImport: RECORD,
};

function harness(setup: Setup = {}): Harness {
  const h: Harness = { deps: undefined as never, notices: [], confirms: [], edits: [], images: [], swaps: [], newTokens: [], placed: [], asked: [] };
  const frontmatter = setup.frontmatter === undefined ? NOTE_FRONTMATTER : setup.frontmatter;
  h.deps = {
    readFrontmatter: () => Promise.resolve(frontmatter),
    askSource: (record) => { h.asked.push(record); return Promise.resolve(setup.picked === undefined ? null : setup.picked); },
    confirmChanges: (preview) => { h.confirms.push(preview); return Promise.resolve(setup.confirm ?? true); },
    writeNote: (_path, edit) => { h.edits.push(edit); return Promise.resolve(); },
    linkedImage: () => Promise.resolve(setup.linkedImage ?? null),
    readImage: () => Promise.resolve(setup.oldBytes ?? null),
    writeImage: (name, bytes) => { h.images.push({ name, bytes }); return Promise.resolve('atlas-vtt/assets/new.png'); },
    swapPortrait: (swap) => { h.swaps.push(swap); return Promise.resolve(); },
    addLinkedToken: (token) => { h.newTokens.push(token); return Promise.resolve(); },
    collectionOf: () => 'crew',
    updatePlacedTokens: (plan) => { h.placed.push(plan); return Promise.resolve(); },
    notify: (message) => { h.notices.push(message); },
  };
  return h;
}

const SAME_VALUES = { hp: 10, skills: ['Axe', 'Bow'], luck: 3 };
const request = (values: Record<string, FieldValue>, extra: Partial<ReimportOptions> = {}, portrait?: ArrayBuffer): ReimportOptions => ({
  notePath: NOTE, importer: importerOf(() => character(values, portrait)), source: file(), ...extra,
});

afterEach(() => setLocale('en', TRANSLATIONS));

describe('re-importing a character', () => {
  it('says "Already up to date" and writes nothing when nothing changed', async () => {
    const h = harness();
    expect(await reimportCharacter(h.deps, request(SAME_VALUES))).toBe('unchanged');
    expect(h.notices).toEqual(['Already up to date']);
    expect(h.edits).toEqual([]);
    expect(h.confirms).toEqual([]);
  });

  it('says it in Chinese too', async () => {
    setLocale('zh', TRANSLATIONS);
    const h = harness();
    await reimportCharacter(h.deps, request(SAME_VALUES));
    expect(h.notices).toEqual(['已是最新']);
  });

  it('records a new source path alone when nothing else changed', async () => {
    const h = harness();
    expect(await reimportCharacter(h.deps, request(SAME_VALUES, { source: file('/moved/Robin.gcs') }))).toBe('unchanged');
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]).toMatchObject({ set: {}, remove: [], record: { source: '/moved/Robin.gcs', keys: ['hp', 'skills', 'luck'] } });
    expect(h.confirms).toEqual([]);
  });

  it('writes nothing when the person cancels the list of changes', async () => {
    const h = harness({ confirm: false });
    expect(await reimportCharacter(h.deps, request({ hp: 12, skills: ['Axe', 'Bow'] }))).toBe('cancelled');
    expect(h.confirms).toHaveLength(1);
    expect(h.edits).toEqual([]);
    expect(h.images).toEqual([]);
    expect(h.placed).toEqual([]);
  });

  it('shows the changes, writes the imported keys only and renews the record', async () => {
    const h = harness();
    const outcome = await reimportCharacter(h.deps, request({ hp: 12, skills: ['Bow', 'Shield'], notes: 'new' }));
    expect(outcome).toBe('updated');
    expect(h.confirms[0]?.changes.map((change) => [change.key, change.kind])).toEqual([['hp', 'changed'], ['skills', 'changed'], ['luck', 'removed'], ['notes', 'added']]);
    expect(h.edits[0]?.set).toEqual({ hp: 12, skills: ['Bow', 'Shield'], notes: 'new' });
    expect(h.edits[0]?.remove).toEqual(['luck']);
    expect(h.edits[0]?.record).toEqual({ importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills', 'notes'] });
  });

  it('keeps the template: whatever template the importer names and keys that are not imported are never written', async () => {
    const h = harness();
    await reimportCharacter(h.deps, request({ hp: 12, 'atlas-template': 'other-template', name: 'Zed' }));
    expect(h.edits[0]?.set).toEqual({ hp: 12 });
    expect(h.confirms[0]?.changes.map((change) => change.key)).toEqual(['hp', 'skills', 'luck']);
  });

  it('keeps the current value the note stores, clamped to the new maximum', async () => {
    const h = harness({ frontmatter: { ...NOTE_FRONTMATTER, hp: '12/27' } });
    await reimportCharacter(h.deps, request({ hp: 15, skills: ['Axe', 'Bow'], luck: 3 }));
    expect(h.edits[0]?.set.hp).toBe('12/15');
    const same = harness({ frontmatter: { ...NOTE_FRONTMATTER, hp: '12/27' } });
    expect(await reimportCharacter(same.deps, request({ hp: 27, skills: ['Axe', 'Bow'], luck: 3 }))).toBe('unchanged');
  });

  it('hands the placed tokens the note as it will be, so damage is kept against the new maxima', async () => {
    const h = harness();
    await reimportCharacter(h.deps, request({ hp: 15, skills: ['Axe', 'Bow'] }));
    expect(h.placed).toEqual([{ notePath: NOTE, after: { statblock: true, 'atlas-template': 'tpl', name: 'Robin', hp: 15, skills: ['Axe', 'Bow'], mine: 'keep', atlasImport: { importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills'] } }, removed: ['luck'], oldImage: null, newImage: null }]);
    expect(h.placed[0]?.after).not.toHaveProperty('luck');
  });

  it('asks for the file when none is given, and records the new path', async () => {
    const h = harness({ picked: file('/elsewhere/Robin.gcs') });
    const { source: _source, ...rest } = request({ hp: 12, skills: ['Axe', 'Bow'], luck: 3 });
    expect(await reimportCharacter(h.deps, rest)).toBe('updated');
    expect(h.asked).toEqual([{ importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills', 'luck'] }]);
    expect(h.edits[0]?.record.source).toBe('/elsewhere/Robin.gcs');
  });

  it('is cancelled when the picker is', async () => {
    const h = harness({ picked: null });
    const { source: _source, ...rest } = request({ hp: 12 });
    expect(await reimportCharacter(h.deps, rest)).toBe('cancelled');
    expect(h.edits).toEqual([]);
  });

  it('lets a parse error reach the caller and writes nothing', async () => {
    const h = harness();
    const failing: ReimportOptions = { notePath: NOTE, importer: importerOf(() => { throw new Error('bad file'); }), source: file() };
    await expect(reimportCharacter(h.deps, failing)).rejects.toThrow('bad file');
    expect(h.edits).toEqual([]);
  });

  describe('portrait', () => {
    it('writes a changed portrait as a new image and points the linked token at it, keeping the old file', async () => {
      const h = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      expect(await reimportCharacter(h.deps, request(SAME_VALUES, {}, PNG_B))).toBe('updated');
      expect(h.confirms[0]?.portrait).toBe(true);
      expect(h.images).toHaveLength(1);
      expect(h.swaps).toEqual([{ notePath: NOTE, oldImage: 'atlas-vtt/assets/old.png', newImage: 'atlas-vtt/assets/new.png' }]);
      expect(h.placed[0]).toMatchObject({ oldImage: 'atlas-vtt/assets/old.png', newImage: 'atlas-vtt/assets/new.png' });
    });

    it('counts equal portrait bytes, a missing portrait and an unsupported one as no change', async () => {
      const equal = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      expect(await reimportCharacter(equal.deps, request(SAME_VALUES, {}, PNG_A))).toBe('unchanged');
      const none = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      expect(await reimportCharacter(none.deps, request(SAME_VALUES))).toBe('unchanged');
      const gif = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      expect(await reimportCharacter(gif.deps, request(SAME_VALUES, {}, GIF))).toBe('unchanged');
      expect([equal, none, gif].flatMap((h) => h.images)).toEqual([]);
    });

    it('creates a linked token when a portrait arrives and the note has none', async () => {
      const h = harness();
      expect(await reimportCharacter(h.deps, request(SAME_VALUES, {}, PNG_A))).toBe('updated');
      expect(h.newTokens).toEqual([{ name: 'Robin', imagePath: 'atlas-vtt/assets/new.png', collection: 'crew', notePath: NOTE }]);
      expect(h.swaps).toEqual([]);
    });

    it('writes nothing of the portrait when the changes are cancelled', async () => {
      const h = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A, confirm: false });
      expect(await reimportCharacter(h.deps, request(SAME_VALUES, {}, PNG_B))).toBe('cancelled');
      expect(h.images).toEqual([]);
      expect(h.swaps).toEqual([]);
    });
  });
});
