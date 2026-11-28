/**
 * The token an imported portrait becomes in a collection's library: one place says how it looks
 * (a ring, no tags), for the first import and for a re-import that brings a portrait to a note
 * that had none.
 */

import type { App } from 'obsidian';
import { AssetService } from '../services/AssetService';

/** Registers the portrait image as a token of the collection and returns its id. */
export async function addImportedTokenAsset(app: App, token: { name: string; imagePath: string; collection: string }): Promise<string> {
  const { name, imagePath, collection } = token;
  return (await AssetService.getInstance(app).addTokenAsset({ name, imagePath, collection, tags: [], showRing: true })).id;
}
