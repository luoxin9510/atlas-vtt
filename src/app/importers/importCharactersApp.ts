/**
 * The running app's side of the character import: the real dependencies of `importCharacterFiles`
 * and the command that starts it.
 */

import type { App, Plugin } from 'obsidian';
import { AssetService } from '../services/AssetService';
import { collectionFolderPath } from '../services/assetPaths';
import { writeAssetImage } from '../services/assetImageFiles';
import { createStatblockNote } from '../statblocks/notes/createStatblockNote';
import { chooseAction } from '../ui/confirmDialog';
import { showNotice } from '../ui/notice';
import { runInBackground } from '../utils/backgroundTask';
import { t } from '../i18n';
import { pickCharacterFiles } from './characterFiles';
import { pickCollection } from './CollectionPickerModal';
import { importCharacterFiles, type ImportDeps } from './importCharacters';
import { registerImportCharactersCommand } from './importCharactersCommand';
import { readImportRecord } from './importRecord';

/** The collection of the open map, when the active file is one. */
function openMapCollection(app: App, assets: AssetService): string | null {
  const file = app.workspace.getActiveFile();
  return file && file.extension === 'atlasmap' ? assets.getCollectionForMap(file.path) : null;
}

/** The collection to import into: the only one, else asked with the open map's offered first; null when dismissed. */
async function chooseCollection(app: App, assets: AssetService): Promise<string | null> {
  const collections = await assets.getCollections();
  const first = collections.length === 1 ? collections[0] : undefined;
  if (first) return first.id;
  const preferred = openMapCollection(app, assets);
  const options = collections.map(({ id, name }) => ({ id, name: name || id }));
  options.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  return options.length === 0 ? null : pickCollection(app, options);
}

/** The path of a note of the collection whose import record names this importer and source. */
function findImportedNote(app: App, collection: string, importerId: string, source: string): string | null {
  const prefix = `${collectionFolderPath(collection)}/`;
  const found = app.vault.getMarkdownFiles().find((file) => {
    if (!file.path.startsWith(prefix)) return false;
    const record = readImportRecord(app.metadataCache.getFileCache(file)?.frontmatter);
    return record?.importer === importerId && record.source === source;
  });
  return found?.path ?? null;
}

function appDeps(app: App): ImportDeps {
  const assets = AssetService.getInstance(app);
  return {
    pickFiles: (extensions) => pickCharacterFiles(activeDocument, extensions),
    chooseCollection: () => chooseCollection(app, assets),
    findImportedNote: (collection, importerId, source) => findImportedNote(app, collection, importerId, source),
    confirmReimport: async (name) => (await chooseAction({
      title: t('importers.alreadyTitle'),
      message: [t('importers.alreadyMessage', { name })],
      choices: [{ label: t('importers.reimport'), value: true, style: 'cta' }],
    })) === true,
    // Replaced by the real re-import in the next step; until then the file is left as it is.
    reimport: () => Promise.resolve('cancelled'),
    writeImage: (name, bytes) => writeAssetImage(app, name, bytes),
    addTokenAsset: async ({ name, imagePath, collection }) => {
      await assets.addTokenAsset({ name, imagePath, collection, tags: [], showRing: true });
    },
    createNote: async (note) => (await createStatblockNote(app, note)).file.path,
    notify: (message) => {
      app.workspace.trigger('atlas-vtt:refresh-assets');
      showNotice(message, 10000);
    },
  };
}

export function registerCharacterImport(plugin: Plugin): void {
  const { app } = plugin;
  registerImportCharactersCommand(plugin, () => runInBackground(importCharacterFiles(appDeps(app)), 'Importing character files', t('importers.failed')));
}

