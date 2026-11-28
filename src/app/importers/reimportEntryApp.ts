/**
 * The running app's side of the re-import entries: where the properties of a note and the active
 * note come from, the shared re-import with the real dependencies, and the registrations (the
 * command and the file menu item go away with the plugin).
 */

import type { App, Plugin } from 'obsidian';
import { showNotice } from '../ui/notice';
import { importerOfNote, addReimportMenuItem, registerReimportCommand, reimportAndReport, type ReimportEntryDeps } from './reimportEntry';
import { reimportDeps } from './reimportApp';
import { reimportCharacter } from './reimportCharacter';

/** The one re-import every entry runs; a failure is a notice. */
async function reimportNote(app: App, notePath: string): Promise<void> {
  const file = app.vault.getFileByPath(notePath);
  const importer = file ? importerOfNote(app.metadataCache.getFileCache(file)?.frontmatter) : null;
  if (!importer) return;
  await reimportAndReport(notePath, importer, (options) => reimportCharacter(reimportDeps(app), options), (message) => showNotice(message, 10000));
}

export function reimportEntryDeps(app: App): ReimportEntryDeps {
  return {
    frontmatterOf: (path) => {
      const file = app.vault.getFileByPath(path);
      return file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    },
    activeNote: () => {
      const file = app.workspace.getActiveFile();
      return file?.extension === 'md' ? file.path : null;
    },
    run: (notePath) => { void reimportNote(app, notePath); },
  };
}

export function registerReimportEntries(plugin: Plugin): void {
  const { app } = plugin;
  const deps = reimportEntryDeps(app);
  registerReimportCommand(plugin, deps);
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => {
    if ('extension' in file && typeof file.extension === 'string') addReimportMenuItem(menu, { path: file.path, extension: file.extension }, deps);
  }));
}
