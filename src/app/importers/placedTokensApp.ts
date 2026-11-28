/**
 * The running app's side of a re-import's effect on placed tokens (P3c decisions 15 and 31): a map
 * open in a view changes its tokens through its store (untracked: a re-import is no edit of the
 * map's, and the view saves itself), every other map file is rewritten in place. Nothing here
 * touches conditions; damage is the clamp of `placedTokenChanges`.
 */

import type { App, TFile } from 'obsidian';
import { ATLAS_VIEW_TYPE, isAtlasView } from '../atlasViewType';
import { mapResources } from '../resources/collectionResources';
import { AssetService } from '../services/AssetService';
import { rulesLookup } from '../services/mapRules';
import { TokenStatblockLinkService } from '../services/TokenStatblockLinkService';
import { runUntracked } from '../stores/history';
import { sceneTokens } from '../tokens/offMap';
import { placedTokenChanges, reimportedMapJson, type PlacedTokenPlan } from './placedTokens';
import type { PlacedTokensUpdate } from './reimportCharacter';
import type { AtlasView } from '../atlas-view';

function openViews(app: App): Map<string, AtlasView> {
  const views = app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).map((leaf) => leaf.view).filter(isAtlasView);
  return new Map(views.flatMap((view) => (view.file ? [[view.file.path, view] as const] : [])));
}

function updateOpenMap(view: AtlasView, plan: PlacedTokenPlan): void {
  const store = view.getStore();
  const entries = Object.entries(sceneTokens(store.getState().objects)).flatMap(([id, token]) => {
    const changes = placedTokenChanges(token, plan);
    return changes ? [{ id, changes }] : [];
  });
  if (entries.length > 0) runUntracked(store, () => store.getState().updateTokens(entries));
}

async function updateClosedMap(app: App, file: TFile, plan: PlacedTokenPlan): Promise<void> {
  if (reimportedMapJson(await app.vault.read(file), plan) === null) return;
  await app.vault.process(file, (latest) => reimportedMapJson(latest, plan) ?? latest);
}

/** Damage kept and the new portrait taken over by every token placed from the note, on every map. */
export async function updatePlacedTokens(app: App, update: PlacedTokensUpdate): Promise<void> {
  const assets = AssetService.getInstance(app);
  // The statblock as the resolver reads it (the template's fields and meanings), the note's new values laid over it.
  const resolved = await TokenStatblockLinkService.getInstance(app).readStatblockRecord(update.notePath);
  const record: Record<string, unknown> = { ...resolved?.fields, ...update.after };
  for (const key of update.removed) delete record[key];
  const views = openViews(app);
  for (const file of app.vault.getFiles().filter((candidate) => candidate.extension === 'atlasmap')) {
    const plan: PlacedTokenPlan = {
      notePath: update.notePath,
      record,
      ...(resolved?.meanings && { meanings: resolved.meanings }),
      definitions: mapResources(rulesLookup(app, assets), file.path),
      oldImage: update.oldImage,
      newImage: update.newImage,
    };
    const view = views.get(file.path);
    try {
      if (view) updateOpenMap(view, plan);
      else await updateClosedMap(app, file, plan);
    } catch (error) {
      console.error(`[reimport] Could not update the tokens of ${file.path}:`, error);
    }
  }
}
