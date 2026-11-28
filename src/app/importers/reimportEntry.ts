/**
 * Where "Re-import" is offered (decision 33): the note's more-options menu, the placed token's
 * context menu and the command palette. All three need the same thing: a note with an import
 * record whose importer is registered (otherwise the entry is hidden), and all three run the one
 * `reimportAndReport`, which says why a re-import failed. The vault is a dependency, so this is
 * tested without one.
 */

import type { Plugin } from 'obsidian';
import { t } from '../i18n';
import type { ContextMenuEntry } from '../react/components/context-menu/AtlasContextMenu';
import { importerById } from './importerRegistry';
import type { CharacterImporter } from './importerTypes';
import { readImportRecord } from './importRecord';
import type { ReimportOutcome } from './importCharacters';
import type { ReimportOptions } from './reimportCharacter';

export interface ReimportEntryDeps {
  /** The properties of the note at `path`; undefined when it has none or is unknown. */
  frontmatterOf(path: string): Record<string, unknown> | undefined;
  /** The path of the active markdown note; null when the active file is none. */
  activeNote(): string | null;
  /** Starts the re-import of the note (never rejects). */
  run(notePath: string): void;
}

/** The importer that re-imports a note with these properties; null without a record or a registered importer of its id. */
export function importerOfNote(frontmatter: Readonly<Record<string, unknown>> | undefined): CharacterImporter | null {
  const record = readImportRecord(frontmatter);
  return (record && importerById(record.importer)) ?? null;
}

/** Re-imports through `reimport`; a failure becomes a notice naming the reason. */
export async function reimportAndReport(
  notePath: string,
  importer: CharacterImporter,
  reimport: (options: ReimportOptions) => Promise<ReimportOutcome>,
  notify: (message: string) => void,
): Promise<void> {
  try {
    await reimport({ notePath, importer });
  } catch (error) {
    console.error('[Atlas] Re-import failed:', error);
    notify(t('importers.reimportFailed', { reason: error instanceof Error ? error.message : String(error) }));
  }
}

/** The command "Re-import the current character", offered while the active note qualifies. */
export function registerReimportCommand(plugin: Pick<Plugin, 'addCommand'>, deps: ReimportEntryDeps): void {
  plugin.addCommand({
    id: 'reimport-current-character',
    name: t('importers.reimportCommand'),
    checkCallback: (checking) => {
      const path = deps.activeNote();
      if (path === null || importerOfNote(deps.frontmatterOf(path)) === null) return false;
      if (!checking) deps.run(path);
      return true;
    },
  });
}

interface MenuItemLike {
  setTitle(title: string): unknown;
  setIcon(icon: string): unknown;
  onClick(click: () => void): unknown;
}

interface MenuLike {
  addItem(build: (item: MenuItemLike) => void): unknown;
}

/** The item in a markdown note's file menu, when the note qualifies. */
export function addReimportMenuItem(menu: MenuLike, file: { path: string; extension: string }, deps: ReimportEntryDeps): void {
  if (file.extension !== 'md' || importerOfNote(deps.frontmatterOf(file.path)) === null) return;
  menu.addItem((item) => {
    item.setTitle(t('importers.reimport'));
    item.setIcon('refresh-cw');
    item.onClick(() => deps.run(file.path));
  });
}

/** The entry of a placed token's context menu for its statblock note; null when the note does not qualify. */
export function reimportTokenEntry(statblockPath: string, deps: Pick<ReimportEntryDeps, 'frontmatterOf' | 'run'>): ContextMenuEntry | null {
  if (importerOfNote(deps.frontmatterOf(statblockPath)) === null) return null;
  return { type: 'item', label: t('importers.reimport'), icon: 'refresh-cw', onClick: () => deps.run(statblockPath) };
}
