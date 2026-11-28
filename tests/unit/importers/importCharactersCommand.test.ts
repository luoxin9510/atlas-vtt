import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from 'obsidian';
import { registerImportCharactersCommand } from '../../../src/app/importers/importCharactersCommand';
import { registerImporter } from '../../../src/app/importers/importerRegistry';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

function commandOf(run: () => void): Command {
  const added: Command[] = [];
  registerImportCharactersCommand({ addCommand: (command: Command) => { added.push(command); return command; } }, run);
  expect(added).toHaveLength(1);
  return added[0]!;
}

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  setLocale('en', TRANSLATIONS);
});

describe('the import character file command', () => {
  it('is registered always, named in the active language', () => {
    expect(commandOf(() => undefined).name).toBe('Import character file…');
    setLocale('zh', TRANSLATIONS);
    expect(commandOf(() => undefined).name).toBe('导入角色文件…');
  });

  it('is hidden while no importer is registered, and never runs then', () => {
    let ran = 0;
    const command = commandOf(() => { ran++; });
    expect(command.checkCallback?.(true)).toBe(false);
    expect(command.checkCallback?.(false)).toBe(false);
    expect(ran).toBe(0);
  });

  it('shows with an importer, runs only when not just checking, and hides again when it is removed', () => {
    let ran = 0;
    const command = commandOf(() => { ran++; });
    const remove = registerImporter({ id: 'pack:gcs', label: 'GCS', extensions: ['gcs'], parse: () => { throw new Error('unused'); } });
    disposers.push(remove);
    expect(command.checkCallback?.(true)).toBe(true);
    expect(ran).toBe(0);
    expect(command.checkCallback?.(false)).toBe(true);
    expect(ran).toBe(1);
    remove();
    expect(command.checkCallback?.(true)).toBe(false);
  });
});
