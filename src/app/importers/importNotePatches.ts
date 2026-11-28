/**
 * The patches a re-import writes into a statblock note's frontmatter (P3c decisions 15, 29, 30):
 * imported keys replaced or removed, the import record renewed, nothing else. They go through the
 * statblock writer (`NoteFieldWriter`), which keeps the YAML as Atlas writes it and the note's body
 * as it is. Pure.
 */

import type { FieldValue } from '../statblocks/model/templateTypes';
import type { NotePatch } from '../statblocks/notes/patchTypes';
import { TEMPLATE_KEY } from '../statblocks/notes/statblockSource';
import { IMPORT_RECORD_KEY, type ImportRecord } from './importRecord';

/** Keys an import never writes into a note: the markers, the template (kept, decision 30), the name and the picture. */
const NOT_IMPORTED: ReadonlySet<string> = new Set(['statblock', TEMPLATE_KEY, 'name', 'image', IMPORT_RECORD_KEY]);

export const isImportableKey = (key: string): boolean => !NOT_IMPORTED.has(key);

/** `values` without the keys an import never writes. */
export function importableValues<T>(values: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => isImportableKey(key)));
}

/**
 * Patches for the note as it is now (`frontmatter`): `set` replaces or adds, `remove` deletes the
 * keys the file no longer gives, and the record names the new source and keys.
 */
export function importPatches(
  frontmatter: Readonly<Record<string, FieldValue | undefined>>,
  set: Readonly<Record<string, FieldValue>>,
  remove: readonly string[],
  record: ImportRecord,
): NotePatch[] {
  const sets = Object.entries(importableValues(set)).map(([key, next]): NotePatch => ({ op: 'set', path: [key], base: frontmatter[key], next }));
  const deletes = remove.filter(isImportableKey).flatMap((key): NotePatch[] => {
    const base = frontmatter[key];
    return base === undefined ? [] : [{ op: 'delete', path: [key], base }];
  });
  const next: FieldValue = { importer: record.importer, source: record.source, keys: [...record.keys] };
  return [...sets, ...deletes, { op: 'set', path: [IMPORT_RECORD_KEY], base: frontmatter[IMPORT_RECORD_KEY], next }];
}
