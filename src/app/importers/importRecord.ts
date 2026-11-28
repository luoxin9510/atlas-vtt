/**
 * The import record: what a statblock note remembers of the file it was imported from, in its
 * frontmatter, so "Re-import" knows the importer, the source and which values the import wrote.
 *
 *     atlasImport:
 *       importer: pack:gcs
 *       source: /Users/me/Characters/Robin.gcs
 *       keys: [name, hp, skills]
 */

import { isPlainRecord } from '../statblocks/values/fieldValueOf';

/** The frontmatter key of the record; reserved, so no template field binds it and no statblock shows it. */
export const IMPORT_RECORD_KEY = 'atlasImport';

export interface ImportRecord {
  /** The id of the importer that read the file. */
  importer: string;
  /** The absolute path of the file the character was read from; empty when the host could not tell (a re-import then asks for the file). */
  source: string;
  /** The keys of the values the last import wrote; only these are replaced by a re-import. */
  keys: string[];
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The record of a note's frontmatter; null when there is none or it is malformed in any part. */
export function readImportRecord(frontmatter: Readonly<Record<string, unknown>> | null | undefined): ImportRecord | null {
  const raw = frontmatter?.[IMPORT_RECORD_KEY];
  if (!isPlainRecord(raw)) return null;
  const { importer, source, keys } = raw;
  if (!isText(importer) || typeof source !== 'string' || !Array.isArray(keys)) return null;
  if (!keys.every((key): key is string => typeof key === 'string')) return null;
  return { importer, source, keys: [...keys] };
}

/** The frontmatter with `record` under its key, replacing an earlier one; the given frontmatter is not changed. */
export function withImportRecord(frontmatter: Readonly<Record<string, unknown>>, record: ImportRecord): Record<string, unknown> {
  return { ...frontmatter, [IMPORT_RECORD_KEY]: { importer: record.importer, source: record.source, keys: [...record.keys] } };
}
