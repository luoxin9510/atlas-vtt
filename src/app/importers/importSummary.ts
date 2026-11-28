/**
 * The one summary of an import run (decision 32): what was imported, updated, skipped and failed,
 * then a line for every failure (`name: reason`) and for every character kept without a token
 * because its portrait was in a format Atlas does not keep (decision 26).
 */

import { formatList, t } from '../i18n';

export interface ImportSummary {
  imported: number;
  updated: number;
  /** Files the person declined to import again, and re-imports that found nothing to change or were cancelled. */
  skipped: number;
  failed: Array<{ name: string; reason: string }>;
  /** Names of the characters imported without a token because their portrait was neither PNG, JPG nor WebP. */
  unsupportedPortrait: string[];
  /** Names of the characters imported without a token because their portrait was over the size Atlas keeps. */
  oversizedPortrait: string[];
}

export function emptySummary(): ImportSummary {
  return { imported: 0, updated: 0, skipped: 0, failed: [], unsupportedPortrait: [], oversizedPortrait: [] };
}

/** "3 imported, 1 updated and 1 failed", then one line per failure and per portrait that was not kept. */
export function summaryText(summary: ImportSummary): string {
  const counts: Array<[number, 'imported' | 'updated' | 'skipped' | 'failed']> = [
    [summary.imported, 'imported'],
    [summary.updated, 'updated'],
    [summary.skipped, 'skipped'],
    [summary.failed.length, 'failed'],
  ];
  const parts = counts.filter(([count]) => count > 0).map(([count, kind]) => t(`importers.count.${kind}`, { count }));
  return [
    formatList(parts),
    ...summary.failed.map(({ name, reason }) => t('importers.line.failed', { name, reason })),
    ...summary.unsupportedPortrait.map((name) => t('importers.line.noPortrait', { name })),
    ...summary.oversizedPortrait.map((name) => t('importers.line.bigPortrait', { name })),
  ].join('\n');
}
