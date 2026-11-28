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
  /** The note's properties as they are right now; a test changes them to play an edit in the editor. */
  current: Record<string, FieldValue> | null;
  order: string[];
}

interface Setup {
  frontmatter?: Record<string, FieldValue> | null;
  linkedImage?: string | null;
  oldBytes?: ArrayBuffer | null;
  confirm?: boolean;
  picked?: PickedFile | null;
  writeFails?: boolean;
}

const RECORD: FieldValue = { importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills', 'luck'] };
const NOTE_FRONTMATTER: Record<string, FieldValue> = {
  statblock: true, 'atlas-template': 'tpl', name: 'Robin', hp: 10, skills: ['Axe', 'Bow'], luck: 3, mine: 'keep', atlasImport: RECORD,
};

function harness(setup: Setup = {}): Harness {
  const h: Harness = { deps: undefined as never, notices: [], confirms: [], edits: [], images: [], swaps: [], newTokens: [], placed: [], asked: [], current: null, order: [] };
  h.current = setup.frontmatter === undefined ? NOTE_FRONTMATTER : setup.frontmatter;
  h.deps = {
    readFrontmatter: () => Promise.resolve(h.current === null ? null : { ...h.current }),
    askSource: (record) => { h.asked.push(record); return Promise.resolve(setup.picked === undefined ? null : setup.picked); },
    confirmChanges: (preview) => { h.confirms.push(preview); return Promise.resolve(setup.confirm ?? true); },
    resourceFields: () => Promise.resolve((key) => key === 'hp'),
    writeNote: (_path, plan) => {
      h.order.push('note');
      if (setup.writeFails) return Promise.reject(new Error('note write failed'));
      h.edits.push(plan(h.current));
      return Promise.resolve();
    },
    linkedImage: () => Promise.resolve(setup.linkedImage ?? null),
    readImage: () => Promise.resolve(setup.oldBytes ?? null),
    writeImage: (name, bytes) => { h.order.push('image'); h.images.push({ name, bytes }); return Promise.resolve('atlas-vtt/assets/new.png'); },
    swapPortrait: (swap) => { h.order.push('swap'); h.swaps.push(swap); return Promise.resolve(); },
    addLinkedToken: (token) => { h.order.push('token'); h.newTokens.push(token); return Promise.resolve(); },
    collectionOf: () => 'crew',
    updatePlacedTokens: (plan) => { h.order.push('placed'); h.placed.push(plan); return Promise.resolve(); },
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

  it('keeps only resource fields: a rating of 1/2 takes the file\'s 2', async () => {
    const h = harness({ frontmatter: { ...NOTE_FRONTMATTER, cr: '1/2' } });
    expect(await reimportCharacter(h.deps, request({ ...SAME_VALUES, cr: 2 }))).toBe('updated');
    expect(h.confirms[0]?.changes.map((change) => change.key)).toEqual(['cr']);
    expect(h.edits[0]?.set.cr).toBe(2);
  });

  describe('an edit while the changes are shown', () => {
    it('keeps the newer current value, clamped, in the note and for the placed tokens', async () => {
      const h = harness({ frontmatter: { ...NOTE_FRONTMATTER, hp: '20/27' } });
      const confirm = h.deps.confirmChanges;
      h.deps.confirmChanges = (preview) => { h.current = { ...NOTE_FRONTMATTER, hp: '8/27', mine: 'typed meanwhile' }; return confirm(preview); };
      await reimportCharacter(h.deps, request({ hp: 15, skills: ['Axe', 'Bow'], luck: 3 }));
      expect(h.confirms[0]?.changes.find((change) => change.key === 'hp')).toBeDefined();
      expect(h.edits[0]?.set.hp).toBe('8/15');
      expect(h.placed[0]?.after.hp).toBe('8/15');
      expect(h.placed[0]?.after.mine).toBe('typed meanwhile');
    });
  });

  describe('a failing write', () => {
    it('leaves the portrait, the token and the placed tokens as they were when the note cannot be written', async () => {
      const h = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A, writeFails: true });
      await expect(reimportCharacter(h.deps, request(SAME_VALUES, {}, PNG_B))).rejects.toThrow('note write failed');
      expect(h.images).toEqual([]);
      expect(h.swaps).toEqual([]);
      expect(h.newTokens).toEqual([]);
      expect(h.placed).toEqual([]);
    });

    it('writes the note first, then the image, then the swap and the placed tokens', async () => {
      const h = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      await reimportCharacter(h.deps, request(SAME_VALUES, {}, PNG_B));
      expect(h.order).toEqual(['note', 'image', 'swap', 'placed']);
    });
  });

  describe('what the importer hands over', () => {
    it('is checked: a character with no name fails the re-import before anything is shown or written', async () => {
      const h = harness();
      const bad: ReimportOptions = { notePath: NOTE, importer: importerOf(() => ({ ...character({ hp: 12 }), name: ' ' })), source: file() };
      await expect(reimportCharacter(h.deps, bad)).rejects.toThrow('no name');
      expect(h.confirms).toEqual([]);
      expect(h.edits).toEqual([]);
    });

    it('is cleaned: keys Obsidian owns are never written to the note', async () => {
      const h = harness();
      await reimportCharacter(h.deps, request({ ...SAME_VALUES, hp: 12, tags: ['x'], cssclasses: ['c'] }));
      expect(h.edits[0]?.set).toEqual({ hp: 12, skills: ['Axe', 'Bow'], luck: 3 });
      expect(h.edits[0]?.set).not.toHaveProperty('tags');
      expect(h.edits[0]?.record.keys).toEqual(['hp', 'skills', 'luck']);
    });
  });

  describe('a portrait that is not kept', () => {
    it('is said in a notice for an unsupported format, and the other changes go on', async () => {
      const h = harness({ linkedImage: 'atlas-vtt/assets/old.png', oldBytes: PNG_A });
      expect(await reimportCharacter(h.deps, request({ ...SAME_VALUES, hp: 12 }, {}, GIF))).toBe('updated');
      expect(h.notices).toEqual(['Robin: the portrait is not PNG, JPG or WebP, so it was not updated.']);
      expect(h.images).toEqual([]);
    });

    it('is said for one over 20 MB, in Chinese too', async () => {
      setLocale('zh', TRANSLATIONS);
      const big = new Uint8Array(20 * 1024 * 1024 + 1);
      big.set(new Uint8Array(PNG_A));
      const h = harness();
      await reimportCharacter(h.deps, request(SAME_VALUES, {}, big.buffer));
      expect(h.notices.some((notice) => notice.includes('Robin') && notice.includes('20 MB'))).toBe(true);
      expect(h.images).toEqual([]);
    });
  });

  describe('a source the host could not name', () => {
    it('is recorded as empty, never as the old path that no longer reads', async () => {
      const h = harness({ picked: file(null) });
      const { source: _source, ...rest } = request({ hp: 12, skills: ['Axe', 'Bow'], luck: 3 });
      await reimportCharacter(h.deps, rest);
      expect(h.edits[0]?.record.source).toBe('');
    });

    it('is recorded as empty even when nothing else changed', async () => {
      const h = harness();
      expect(await reimportCharacter(h.deps, request(SAME_VALUES, { source: file(null) }))).toBe('unchanged');
      expect(h.edits[0]?.record.source).toBe('');
    });
  });
});
