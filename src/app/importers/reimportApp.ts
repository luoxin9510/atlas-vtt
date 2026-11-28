/**
 * The running app's side of a re-import: the real dependencies of `reimportCharacter`. Note values
 * go through the statblock writer (`NoteFieldWriter`: the YAML stays as Atlas writes it, an open
 * editor keeps unsaved typing, the body is never touched); tokens go through the asset index and
 * the statblock link service.
 */

import { TFile, type App } from 'obsidian';
import { collectionResources } from '../resources/collectionResources';
import { AssetService } from '../services/AssetService';
import { collectionIdOfPath } from '../services/assetPaths';
import { writeAssetImage } from '../services/assetImageFiles';
import { TokenStatblockLinkService } from '../services/TokenStatblockLinkService';
import { showNotice } from '../ui/notice';
import type { FieldValue } from '../statblocks/model/templateTypes';
import { NoteFieldWriter } from '../statblocks/notes/NoteFieldWriter';
import { NO_MEANINGS } from '../statblocks/resolve/fieldMeanings';
import { readStatblock } from '../statblocks/resolve/readStatblock';
import { frontmatterOfText } from '../statblocks/notes/statblockSource';
import { findOrAskSource } from './characterFiles';
import { importPatches } from './importNotePatches';
import { updatePlacedTokens } from './placedTokensApp';
import { confirmChanges } from './ReimportChangesModal';
import { addImportedTokenAsset } from './importedTokenAsset';
import { isResourceFieldOf } from './resourceFieldKeys';
import type { NotePlan, ReimportDeps } from './reimportCharacter';

/** The note is written from the plan worked out against its properties at this moment, inside the patch. */
async function writeNote(app: App, notePath: string, plan: NotePlan): Promise<void> {
  const outcome = await NoteFieldWriter.forApp(app).patchNow(notePath, (frontmatter) => {
    if (!frontmatter) return [];
    const edit = plan(frontmatter);
    return importPatches(frontmatter, edit.set, edit.remove, edit.record);
  });
  if (outcome.problem) throw new Error(outcome.problem);
  if (outcome.conflicts.length > 0) throw new Error(`The note changed while it was written: ${notePath}`);
}

/** The note's picture follows its portrait when it showed the old one. */
async function pointNoteImage(app: App, notePath: string, oldImage: string, newImage: string): Promise<void> {
  const links = TokenStatblockLinkService.getInstance(app);
  const file = app.vault.getFileByPath(notePath);
  const shown = file ? links.readStatblockImage(file) : null;
  if (shown === null || !links.arePathsEquivalent(shown, oldImage)) return;
  await NoteFieldWriter.forApp(app).patchNow(notePath, (frontmatter) => [{ op: 'set', path: ['image'], base: frontmatter?.image, next: newImage }]);
}

async function swapPortrait(app: App, swap: { notePath: string; oldImage: string; newImage: string }): Promise<void> {
  const assets = AssetService.getInstance(app);
  const linked = (await assets.getTokenAssets()).filter((asset) => asset.imagePath === swap.oldImage && asset.statblockPath === swap.notePath);
  // The old thumbnail shows the old art; it is made again from the new image.
  for (const asset of linked) await assets.updateAsset(asset.id, { imagePath: swap.newImage, thumbnailPath: undefined });
  await pointNoteImage(app, swap.notePath, swap.oldImage, swap.newImage);
  app.workspace.trigger('atlas-vtt:refresh-assets');
}

/** Which fields of the note are resources: its template's tracked numbers and hit points, and the collection's counting resources. */
async function resourceFields(app: App, notePath: string): Promise<(key: string) => boolean> {
  const statblock = await readStatblock(app, notePath);
  const collection = collectionIdOfPath(notePath);
  const resources = collection === null ? [] : collectionResources(AssetService.getInstance(app).getCollectionSettings(collection));
  return isResourceFieldOf(statblock?.source.kind === 'atlas' ? statblock.template : null, resources, statblock?.meanings ?? NO_MEANINGS);
}

export function reimportDeps(app: App): ReimportDeps {
  return {
    readFrontmatter: async (notePath) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      return file instanceof TFile ? (frontmatterOfText(await app.vault.read(file)) as Record<string, FieldValue> | null) : null;
    },
    askSource: (record, extensions) => findOrAskSource(record, activeDocument, extensions),
    confirmChanges: (preview) => confirmChanges(app, preview),
    resourceFields: (notePath) => resourceFields(app, notePath),
    writeNote: (notePath, plan) => writeNote(app, notePath, plan),
    linkedImage: async (notePath) => (await TokenStatblockLinkService.getInstance(app).getTokensLinkedToStatblock(notePath))[0] ?? null,
    readImage: async (path) => {
      try {
        return await app.vault.adapter.readBinary(path);
      } catch {
        return null;
      }
    },
    writeImage: (name, bytes) => writeAssetImage(app, name, bytes),
    swapPortrait: (swap) => swapPortrait(app, swap),
    addLinkedToken: async ({ name, imagePath, collection, notePath }) => {
      await addImportedTokenAsset(app, { name, imagePath, collection });
      await TokenStatblockLinkService.getInstance(app).linkTokenToStatblock(imagePath, notePath, { notice: false });
    },
    collectionOf: (notePath) => collectionIdOfPath(notePath),
    updatePlacedTokens: (update) => updatePlacedTokens(app, update),
    notify: (message) => showNotice(message),
  };
}
