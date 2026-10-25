import { type App } from 'obsidian';
import { IMAGE_PRESETS, optimizeImage } from '../../imageProcessing/imageProcessing';
import type { AssetService } from '../../services/AssetService';
import { AssetThumbnailService, THUMBNAIL_SPEC } from '../../services/AssetThumbnailService';
import { importUvttFile, type UvttImportDeps, type UvttImported } from './importUvttFile';
import { showNotice } from '../../ui/notice';
import { t } from '../../i18n';

/** A refusal stays long enough to read its reason. */
const PROBLEM_NOTICE_MS = 12_000;

/** What an import brought, for its notice: `Imported "Crypt": 412 walls, 9 doors, 14 lights.` */
export function uvttImportSummary({ name, counts, lightsOff, scaledDown }: UvttImported): string {
  const parts = [t('uvttImport.summary', {
    name,
    walls: t('uvttImport.walls', { count: counts.walls }),
    doors: t('uvttImport.doors', { count: counts.doors }),
    lights: t('uvttImport.lights', { count: counts.lights }),
  })];
  if (lightsOff) parts.push(t('uvttImport.lightsOff'));
  if (scaledDown) parts.push(t('uvttImport.scaledDown', { width: String(scaledDown.to.width), height: String(scaledDown.to.height) }));
  return parts.join(' ');
}

function importDeps(app: App, assetService: AssetService): UvttImportDeps {
  return {
    app,
    assetService,
    convertImage: (image) => optimizeImage(image, IMAGE_PRESETS.map, { thumbnail: THUMBNAIL_SPEC }),
    thumbnails: AssetThumbnailService.getInstance(app, assetService),
  };
}

/**
 * Imports Universal VTT files into a collection, one after the other, each with a notice while
 * it runs and one for its result: what it brought, or why it was refused. Returns the imports
 * that arrived.
 */
export async function runUvttImport(app: App, assetService: AssetService, files: readonly File[], collectionId: string): Promise<UvttImported[]> {
  const deps = importDeps(app, assetService);
  const imported: UvttImported[] = [];
  for (const file of files) {
    const progress = showNotice(t('uvttImport.importing', { name: file.name }), 0);
    const result = await importUvttFile(deps, file, collectionId);
    progress.hide();
    if (result.ok) {
      imported.push(result);
      showNotice(uvttImportSummary(result));
    } else {
      showNotice(t('uvttImport.failed', { name: file.name, problem: result.problem }), PROBLEM_NOTICE_MS);
    }
  }
  if (imported.length > 0) app.workspace.trigger('atlas-vtt:refresh-assets');
  return imported;
}
