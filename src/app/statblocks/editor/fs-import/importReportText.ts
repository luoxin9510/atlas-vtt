/**
 * The words of the dialog after a Fantasy Statblocks import (§6.2, §6.4),
 * written for someone who never saw the layout's code: what Atlas can do
 * now, what of the look it cannot show, and what moving the statblocks does.
 */

import type { LayoutStatblocks } from '../../fs/fsLayoutStatblocks';
import type { FsImportReport } from '../../fs/fsLayoutTypes';
import { t } from '../../../i18n';

/** "DaggerHeart Adversary is ready" */
export function readyTitle(layoutName: string): string {
  return t('sbEditor.import.readyTitle', { name: layoutName });
}

/** "Atlas can now show statblocks the way DaggerHeart Adversary does." */
export function readyLine(layoutName: string): string {
  return t('sbEditor.import.readyLine', { name: layoutName });
}

/** "One part shows simpler than in Fantasy Statblocks.": its values, without the look its layout draws; null when Atlas draws every part. */
export function fsOnlyLine(parts: number): string | null {
  if (parts === 0) return null;
  return t('sbEditor.import.fsOnly', { count: parts });
}

/** What of the look Atlas left out or shows simpler; null where it kept all of it. */
export function detailsLine(report: FsImportReport | null): string | null {
  const left = (report?.dropped.length ?? 0) > 0;
  const simpler = (report?.partial.length ?? 0) > 0;
  if (left && simpler) return t('sbEditor.import.someLeftOutOrSimpler');
  if (left) return t('sbEditor.import.someLeftOut');
  return simpler ? t('sbEditor.import.someSimpler') : null;
}

/** Each detail the import left out or shows simpler, in the report's own sentences. */
export function detailSentences(report: FsImportReport | null): string[] {
  return report ? [...report.dropped, ...report.partial] : [];
}

/** "Show the 3 details" */
export function detailsToggleLabel(count: number): string {
  return t('sbEditor.import.showDetails', { count });
}

/** "Move 214 statblocks to Atlas" */
export function moveLabel(count: number): string {
  return t('sbEditor.import.move', { count });
}

/** What moving the statblocks does, said once for what every one gets and once for those written into a note's text. */
export function moveExplanation(statblocks: LayoutStatblocks): string {
  return t(statblocks.fences.length === 0 ? 'sbEditor.import.moveExplanation' : 'sbEditor.import.moveExplanationWithFences');
}

/** What the list says of a statblock: only where it sits in its note's text, which moving changes. */
export function placeLabel(kind: keyof LayoutStatblocks): string | undefined {
  return kind === 'fences' ? t('sbEditor.import.inNoteText') : undefined;
}

/** What a batch did: "Moved 214 statblocks." or "Moved 12 of 214 statblocks." */
export function movedLine(moved: number, total: number): string {
  return moved === total ? t('sbEditor.import.movedAll', { count: total }) : t('sbEditor.import.movedSome', { moved, count: total });
}

/** "Show the statblock left as it was", "Show the 3 statblocks left as they were". */
export function leftoversLabel(count: number): string {
  return t('sbEditor.import.showLeftovers', { count });
}
