import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from 'obsidian';
import {
  addReimportMenuItem, importerOfNote, reimportAndReport, reimportTokenEntry, registerReimportCommand,
  type ReimportEntryDeps,
} from '../../../src/app/importers/reimportEntry';
import { registerImporter } from '../../../src/app/importers/importerRegistry';
import type { CharacterImporter } from '../../../src/app/importers/importerTypes';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

const NOTE = 'atlas-vtt/collections/crew/characters/Robin.md';
const IMPORTED = { atlasImport: { importer: 'pack:gcs', source: '/c/Robin.gcs', keys: ['name'] } };
const importer: CharacterImporter = { id: 'pack:gcs', label: 'GCS', extensions: ['gcs'], parse: () => { throw new Error('unused'); } };

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  setLocale('en', TRANSLATIONS);
});
const withImporter = (): void => { disposers.push(registerImporter(importer)); };

function depsOf(frontmatter: Record<string, unknown> | undefined, active: string | null = NOTE): { deps: ReimportEntryDeps; ran: string[] } {
  const ran: string[] = [];
  return { ran, deps: { frontmatterOf: () => frontmatter, activeNote: () => active, run: (path) => { ran.push(path); } } };
}

describe('which notes can be re-imported', () => {
  it('needs an import record and a registered importer of that id', () => {
    withImporter();
    expect(importerOfNote(IMPORTED)?.id).toBe('pack:gcs');
  });
  it('is not offered without a record', () => {
    withImporter();
    expect(importerOfNote({ name: 'Robin' })).toBeNull();
    expect(importerOfNote(undefined)).toBeNull();
  });
  it('is not offered when no importer has the recorded id', () => {
    expect(importerOfNote(IMPORTED)).toBeNull();
    disposers.push(registerImporter({ ...importer, id: 'pack:other' }));
    expect(importerOfNote(IMPORTED)).toBeNull();
  });
});

describe('the re-import command', () => {
  function commandOf(deps: ReimportEntryDeps): Command {
    const added: Command[] = [];
    registerReimportCommand({ addCommand: (command: Command) => { added.push(command); return command; } }, deps);
    expect(added).toHaveLength(1);
    return added[0]!;
  }

  it('is named in the active language', () => {
    expect(commandOf(depsOf(IMPORTED).deps).name).toBe('Re-import the current character');
    setLocale('zh', TRANSLATIONS);
    expect(commandOf(depsOf(IMPORTED).deps).name).toBe('重新导入当前角色');
  });
  it('is offered for a qualifying active note and runs only when not checking', () => {
    withImporter();
    const { deps, ran } = depsOf(IMPORTED);
    const command = commandOf(deps);
    expect(command.checkCallback?.(true)).toBe(true);
    expect(ran).toEqual([]);
    expect(command.checkCallback?.(false)).toBe(true);
    expect(ran).toEqual([NOTE]);
  });
  it('is hidden without an active note, a record or an importer', () => {
    expect(commandOf(depsOf(IMPORTED).deps).checkCallback?.(true)).toBe(false);
    withImporter();
    expect(commandOf(depsOf(undefined).deps).checkCallback?.(true)).toBe(false);
    expect(commandOf(depsOf(IMPORTED, null).deps).checkCallback?.(true)).toBe(false);
  });
});

describe('the note menu item', () => {
  interface Added { title: string; icon: string; click: () => void }
  function menuOf(): { menu: { addItem(build: (item: unknown) => void): unknown }; items: Added[] } {
    const items: Added[] = [];
    const menu = {
      addItem: (build: (item: unknown) => void): unknown => {
        const added: Added = { title: '', icon: '', click: () => undefined };
        const item = {
          setTitle: (title: string) => { added.title = title; return item; },
          setIcon: (icon: string) => { added.icon = icon; return item; },
          onClick: (click: () => void) => { added.click = click; return item; },
        };
        build(item);
        items.push(added);
        return menu;
      },
    };
    return { menu, items };
  }

  it('is added for a markdown note with a record and an importer, and runs the re-import', () => {
    withImporter();
    const { deps, ran } = depsOf(IMPORTED);
    const { menu, items } = menuOf();
    addReimportMenuItem(menu, { path: NOTE, extension: 'md' }, deps);
    expect(items.map((item) => item.title)).toEqual(['Re-import']);
    items[0]!.click();
    expect(ran).toEqual([NOTE]);
  });
  it('is absent without a record, without an importer, and for other files', () => {
    const { menu, items } = menuOf();
    addReimportMenuItem(menu, { path: NOTE, extension: 'md' }, depsOf(IMPORTED).deps);
    withImporter();
    addReimportMenuItem(menu, { path: NOTE, extension: 'md' }, depsOf({ name: 'Robin' }).deps);
    addReimportMenuItem(menu, { path: 'a/Map.atlasmap', extension: 'atlasmap' }, depsOf(IMPORTED).deps);
    expect(items).toEqual([]);
  });
});

describe('the token menu entry', () => {
  it('is an item for a qualifying statblock path that runs the shared re-import with that path', () => {
    withImporter();
    const { deps, ran } = depsOf(IMPORTED);
    const entry = reimportTokenEntry(NOTE, deps);
    expect(entry).toMatchObject({ type: 'item', label: 'Re-import' });
    if (entry?.type === 'item') void entry.onClick();
    expect(ran).toEqual([NOTE]);
  });
  it('is absent without a record or importer', () => {
    expect(reimportTokenEntry(NOTE, depsOf(IMPORTED).deps)).toBeNull();
    withImporter();
    expect(reimportTokenEntry(NOTE, depsOf(undefined).deps)).toBeNull();
  });
});

describe('the shared re-import', () => {
  it('re-imports the note with its importer and says nothing on success', async () => {
    const calls: Array<{ notePath: string; id: string }> = [];
    const notices: string[] = [];
    await reimportAndReport(NOTE, importer, (options) => { calls.push({ notePath: options.notePath, id: options.importer.id }); return Promise.resolve('updated'); }, (m) => notices.push(m));
    expect(calls).toEqual([{ notePath: NOTE, id: 'pack:gcs' }]);
    expect(notices).toEqual([]);
  });
  it('turns a failure into a notice with the reason, in both languages', async () => {
    const notices: string[] = [];
    const fail = (): Promise<'updated'> => Promise.reject(new Error('bad file'));
    await reimportAndReport(NOTE, importer, fail, (m) => notices.push(m));
    setLocale('zh', TRANSLATIONS);
    await reimportAndReport(NOTE, importer, fail, (m) => notices.push(m));
    expect(notices[0]).toBe('Re-import failed: bad file');
    expect(notices[1]).toBe('重新导入失败：bad file');
  });
});
