import type { App } from 'obsidian';
import { migratePlayerResourceVisibility } from '../resources/playerVisibilityMigration';
import { AssetService } from '../services/AssetService';
import { storeLegacyCollectionResources } from '../services/collectionScenes';
import type { SettingsService } from '../services/SettingsService';

/**
 * Once per collection and vault: the HP and secondary bars of collections saved before
 * resources existed become their resources, and what the old player-window switches
 * showed becomes "visible to players" on them.
 */
export async function carryOverTokenBars(app: App, settings: SettingsService): Promise<void> {
  await settings.initialize();
  const assets = AssetService.getInstance(app);
  await assets.initialize();
  await storeLegacyCollectionResources(app);
  await migratePlayerResourceVisibility(settings, assets);
}
