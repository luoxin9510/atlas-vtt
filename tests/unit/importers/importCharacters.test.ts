import { afterEach, describe, expect, it } from 'vitest';
import { importCharacterFiles, type ImportDeps, type ReimportRequest } from '../../../src/app/importers/importCharacters';
import { registerImporter } from '../../../src/app/importers/importerRegistry';
import type { CharacterImporter, ImportedCharacter } from '../../../src/app/importers/importerTypes';
import { readImportRecord } from '../../../src/app/importers/importRecord';
import type { PickedFile } from '../../../src/app/importers/characterFiles';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0];

const bytesOf = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;
const file = (fileName: string, path: string | null = `/chars/${fileName}`): PickedFile => ({ path, fileName, bytes: bytesOf([1]) });
const character = (name: string, portrait?: number[]): ImportedCharacter => ({
  name, templateId: 'tpl', values: { hp: 10, skills: ['a', 'b'] }, ...(portrait && { portrait: { bytes: bytesOf(portrait) } }),
});

interface Harness {
  deps: ImportDeps;
  notes: Array<{ name: string; templateId: string; folder: string; tokenImagePath?: string | undefined; values: Record<string, unknown> }>;
  images: Array<{ name: string; bytes: ArrayBuffer }>;
  tokens: Array<{ name: string; imagePath: string; collection: string }>;
  removed: string[];
  reimports: ReimportRequest[];
  confirmed: string[];
  notices: string[];
  order: string[];
}

function harness(picked: PickedFile[], overrides: Partial<ImportDeps> = {}): Harness {
  const h: Harness = { deps: undefined as never, notes: [], images: [], tokens: [], removed: [], reimports: [], confirmed: [], notices: [], order: [] };
  h.deps = {
    pickFiles: () => Promise.resolve(picked),
    chooseCollection: () => Promise.resolve('crew'),
    templateExists: (id) => Promise.resolve(id === 'tpl'),
    findImportedNote: () => null,
    confirmReimport: (name) => { h.confirmed.push(name); return Promise.resolve(true); },
    reimport: (request) => { h.reimports.push(request); return Promise.resolve('updated'); },
    writeImage: (name, bytes) => { h.order.push('image'); h.images.push({ name, bytes }); return Promise.resolve(`atlas-vtt/assets/${name}.png`); },
    addTokenAsset: (asset) => { h.order.push('token'); h.tokens.push(asset); return Promise.resolve(`token-${h.tokens.length}`); },
    removeTokenAsset: (id) => { h.removed.push(id); return Promise.resolve(); },
    createNote: (note) => { h.order.push('note'); h.notes.push(note); return Promise.resolve(`${note.folder}/${note.name}.md`); },
    notify: (message) => { h.notices.push(message); },
    ...overrides,
  };
  return h;
}

const disposers: Array<() => void> = [];
function register(parse: CharacterImporter['parse'], id = 'pack:gcs', extensions = ['gcs']): void {
  disposers.push(registerImporter({ id, label: 'Test', extensions, parse }));
}
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  setLocale('en', TRANSLATIONS);
});

describe('importing character files', () => {
  it('creates the note in the collection\'s characters folder with the values and the import record', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes).toHaveLength(1);
    const [note] = h.notes;
    expect(note).toMatchObject({ name: 'Robin', templateId: 'tpl', folder: 'atlas-vtt/collections/crew/characters' });
    expect(note?.values).toMatchObject({ hp: 10, skills: ['a', 'b'] });
    expect(readImportRecord(note?.values)).toEqual({ importer: 'pack:gcs', source: '/chars/Robin.gcs', keys: ['hp', 'skills'] });
  });

  it('asks only for the extensions of the registered importers', async () => {
    register(() => character('A'), 'pack:a', ['gcs']);
    register(() => character('B'), 'pack:b', ['json']);
    let asked: readonly string[] = [];
    const h = harness([], { pickFiles: (extensions) => { asked = extensions; return Promise.resolve([]); } });
    await importCharacterFiles(h.deps);
    expect(asked).toEqual(['gcs', 'json']);
  });

  it('does nothing, not even a notice, when no file is picked or the collection is not chosen', async () => {
    register(() => character('Robin'));
    const none = harness([]);
    await importCharacterFiles(none.deps);
    const cancelled = harness([file('Robin.gcs')], { chooseCollection: () => Promise.resolve(null) });
    await importCharacterFiles(cancelled.deps);
    expect(none.notices).toEqual([]);
    expect(cancelled.notices).toEqual([]);
    expect(cancelled.notes).toEqual([]);
  });

  it('fails a file no importer reads, with the others going on', async () => {
    register(() => character('Robin'));
    const h = harness([file('notes.txt'), file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes.map((note) => note.name)).toEqual(['Robin']);
    expect(h.notices[0]).toBe('1 imported and 1 failed\nnotes.txt: No importer reads this kind of file.');
  });

  it('fails a file whose parse throws or rejects, with its message, and goes on', async () => {
    register((_bytes, fileName) => {
      if (fileName === 'sync.gcs') throw new Error('bad header');
      if (fileName === 'async.gcs') return Promise.reject(new Error('bad body'));
      return character('Robin');
    });
    const h = harness([file('sync.gcs'), file('async.gcs'), file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes.map((note) => note.name)).toEqual(['Robin']);
    expect(h.notices[0]).toBe('1 imported and 2 failed\nsync.gcs: bad header\nasync.gcs: bad body');
  });

  it('fails a file whose note cannot be created, with the others going on', async () => {
    register((_bytes, fileName) => character(fileName.replace('.gcs', '')));
    let calls = 0;
    const h = harness([file('A.gcs'), file('B.gcs')], {
      createNote: (note) => (calls++ === 0 ? Promise.reject(new Error('disk full')) : Promise.resolve(`${note.folder}/${note.name}.md`)),
    });
    await importCharacterFiles(h.deps);
    expect(h.notices[0]).toBe('1 imported and 1 failed\nA: disk full');
  });

  it('leaves no token behind when the note cannot be created', async () => {
    register(() => character('Robin', PNG));
    const h = harness([file('Robin.gcs')], { createNote: () => Promise.reject(new Error('disk full')) });
    await importCharacterFiles(h.deps);
    expect(h.tokens).toHaveLength(1);
    expect(h.removed).toEqual(['token-1']);
    expect(h.notices[0]).toBe('1 failed\nRobin: disk full');
  });

  it('still reports the note error when removing the token fails too', async () => {
    register(() => character('Robin', PNG));
    const h = harness([file('Robin.gcs')], {
      createNote: () => Promise.reject(new Error('disk full')),
      removeTokenAsset: () => Promise.reject(new Error('locked')),
    });
    await importCharacterFiles(h.deps);
    expect(h.notices[0]).toBe('1 failed\nRobin: disk full');
  });

  it('removes nothing when there was no token', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], { createNote: () => Promise.reject(new Error('disk full')) });
    await importCharacterFiles(h.deps);
    expect(h.removed).toEqual([]);
  });

  it('keeps the source empty for a file whose path is unknown, and still imports it', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs', null)]);
    await importCharacterFiles(h.deps);
    expect(readImportRecord(h.notes[0]?.values)?.source).toBe('');
  });

  it('makes a different character with the same name a new note, never asking about the first', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs', '/other/Robin.gcs')], { findImportedNote: (_c, _i, source) => (source === '/chars/Robin.gcs' ? 'x.md' : null) });
    await importCharacterFiles(h.deps);
    expect(h.confirmed).toEqual([]);
    expect(h.notes).toHaveLength(1);
  });
});

describe('portraits', () => {
  it.each([['PNG', PNG], ['JPG', JPG], ['WebP', WEBP]])('keeps a %s portrait as a token linked to the note', async (_name, bytes) => {
    register(() => character('Robin', bytes));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.images).toHaveLength(1);
    expect(new Uint8Array(h.images[0]!.bytes)).toEqual(new Uint8Array(bytes));
    expect(h.tokens).toEqual([{ name: 'Robin', imagePath: 'atlas-vtt/assets/Robin.png', collection: 'crew' }]);
    expect(h.notes[0]?.tokenImagePath).toBe('atlas-vtt/assets/Robin.png');
    expect(h.order).toEqual(['image', 'token', 'note']);
  });

  it.each([['GIF', GIF], ['garbage', [1, 2, 3]], ['too short', [0x89]], ['RIFF but not WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]]])(
    'imports a %s portrait without a token and says so in the summary',
    async (_name, bytes) => {
      register(() => character('Robin', bytes));
      const h = harness([file('Robin.gcs')]);
      await importCharacterFiles(h.deps);
      expect(h.images).toEqual([]);
      expect(h.tokens).toEqual([]);
      expect(h.notes).toHaveLength(1);
      expect(h.notes[0]?.tokenImagePath).toBeUndefined();
      expect(h.notices[0]).toContain('Robin: the portrait is not PNG, JPG or WebP');
    },
  );

  it('imports a character without a portrait quietly: note only', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.tokens).toEqual([]);
    expect(h.notices[0]).toBe('1 imported');
  });
});

describe('what an importer hands over is checked', () => {
  it('fails a file whose template does not exist, with the reason, and creates nothing', async () => {
    register(() => ({ ...character('Robin'), templateId: 'gone' }));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes).toEqual([]);
    expect(h.images).toEqual([]);
    expect(h.notices[0]).toBe('1 failed\nRobin.gcs: The template "gone" does not exist.');
  });

  it('fails a file whose character has no name or values that are no data', async () => {
    register((_bytes, name) => (name === 'a.gcs' ? ({ ...character(''), name: '  ' }) : ({ ...character('B'), values: { f: () => 1 } as never })));
    const h = harness([file('a.gcs'), file('b.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes).toEqual([]);
    expect(h.notices[0]).toContain('2 failed');
  });

  it('imports the cleaned values: no markers and no keys Obsidian owns, in the record too', async () => {
    register(() => ({ ...character('Robin'), values: { hp: 10, tags: ['x'], name: 'Z', statblock: false } }));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.notes[0]?.values).toMatchObject({ hp: 10 });
    expect(h.notes[0]?.values).not.toHaveProperty('tags');
    expect(readImportRecord(h.notes[0]?.values)?.keys).toEqual(['hp']);
  });

  it('imports a character with a portrait over 20 MB without a token, and says so', async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(PNG);
    register(() => ({ ...character('Robin'), portrait: { bytes: big.buffer } }));
    const h = harness([file('Robin.gcs')]);
    await importCharacterFiles(h.deps);
    expect(h.images).toEqual([]);
    expect(h.tokens).toEqual([]);
    expect(h.notes).toHaveLength(1);
    expect(h.notices[0]).toBe('1 imported\nRobin: the portrait is larger than 20 MB, so it was imported without a token.');
  });
});

describe('importing the same source again', () => {
  const NOTE = 'atlas-vtt/collections/crew/characters/Robin.md';

  it('asks, and hands over to the re-import when told yes', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], {
      findImportedNote: (collection, importer, source) => (collection === 'crew' && importer === 'pack:gcs' && source === '/chars/Robin.gcs' ? NOTE : null),
    });
    await importCharacterFiles(h.deps);
    expect(h.confirmed).toEqual(['Robin']);
    expect(h.notes).toEqual([]);
    expect(h.reimports).toHaveLength(1);
    expect(h.reimports[0]).toMatchObject({ notePath: NOTE, collection: 'crew', character: { name: 'Robin' }, source: { path: '/chars/Robin.gcs' } });
    expect(h.reimports[0]?.importer.id).toBe('pack:gcs');
    expect(h.notices[0]).toBe('1 updated');
  });

  it('re-imports even when the importer names a template the library lacks: the note keeps its own (decision 30)', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], { findImportedNote: () => NOTE, templateExists: () => Promise.resolve(false) });
    await importCharacterFiles(h.deps);
    expect(h.reimports).toHaveLength(1);
    expect(h.notices[0]).toBe('1 updated');
  });

  it('skips the file when told no', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], { findImportedNote: () => NOTE, confirmReimport: () => Promise.resolve(false) });
    await importCharacterFiles(h.deps);
    expect(h.reimports).toEqual([]);
    expect(h.notes).toEqual([]);
    expect(h.notices[0]).toBe('1 skipped');
  });

  it.each([['unchanged', '1 skipped'], ['cancelled', '1 skipped'], ['updated', '1 updated']] as const)('counts a re-import that is %s', async (outcome, text) => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], { findImportedNote: () => NOTE, reimport: () => Promise.resolve(outcome) });
    await importCharacterFiles(h.deps);
    expect(h.notices[0]).toBe(text);
  });

  it('fails the file when the re-import throws', async () => {
    register(() => character('Robin'));
    const h = harness([file('Robin.gcs')], { findImportedNote: () => NOTE, reimport: () => Promise.reject(new Error('locked')) });
    await importCharacterFiles(h.deps);
    expect(h.notices[0]).toBe('1 failed\nRobin: locked');
  });

  it('never matches a file without a known path', async () => {
    register(() => character('Robin'));
    let looked = false;
    const h = harness([file('Robin.gcs', null)], { findImportedNote: () => { looked = true; return NOTE; } });
    await importCharacterFiles(h.deps);
    expect(looked).toBe(false);
    expect(h.notes).toHaveLength(1);
  });
});

describe('the summary', () => {
  function mixed(): Harness {
    register((_bytes, fileName) => {
      if (fileName === 'bad.gcs') throw new Error('broken');
      return character(fileName.replace('.gcs', ''), fileName === 'Gif.gcs' ? GIF : fileName === 'Pic.gcs' ? PNG : undefined);
    });
    return harness([file('Pic.gcs'), file('Gif.gcs'), file('bad.gcs'), file('Old.gcs'), file('Skip.gcs')], {
      findImportedNote: (_c, _i, source) => (source.endsWith('Old.gcs') || source.endsWith('Skip.gcs') ? 'x.md' : null),
      confirmReimport: (name) => Promise.resolve(name === 'Old'),
    });
  }

  it('counts every outcome, with failures and portrait-less characters on their own lines', async () => {
    const h = mixed();
    await importCharacterFiles(h.deps);
    expect(h.notices).toEqual([[
      '2 imported, 1 updated, 1 skipped, and 1 failed',
      'bad.gcs: broken',
      'Gif: the portrait is not PNG, JPG or WebP, so it was imported without a token.',
    ].join('\n')]);
  });

  it('speaks Chinese when the language is', async () => {
    setLocale('zh', TRANSLATIONS);
    const h = mixed();
    await importCharacterFiles(h.deps);
    expect(h.notices[0]?.split('\n')[0]).toBe('已导入 2 个、已更新 1 个、已跳过 1 个和失败 1 个');
    expect(h.notices[0]).toContain('bad.gcs：broken');
    expect(h.notices[0]).toContain('Gif：头像不是 PNG、JPG 或 WebP，已导入但未创建棋子。');
  });
});
