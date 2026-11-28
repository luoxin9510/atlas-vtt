/**
 * What a rule pack's character importer hands to Atlas: a parsed character file as the name, the
 * statblock template to use, the values of its fields and, optionally, the portrait's bytes.
 */

import type { FieldValue } from '../statblocks/model/templateTypes';

export interface ImportedCharacter {
  /** The character's name: the note's name and its statblock's. */
  name: string;
  /** The id of the statblock template the character's values are written for. */
  templateId: string;
  /** The statblock's values by field key. */
  values: Record<string, FieldValue>;
  /** The portrait as the file holds it; Atlas keeps PNG, JPG and WebP and imports without one otherwise. */
  portrait?: { bytes: ArrayBuffer };
}

export interface CharacterImporter {
  /** The registration id, `<pack>:<importer>`; `builtin:` ids are Atlas's own and refused. */
  id: string;
  /** What the importer is called where Atlas names it (the file picker, the summary). */
  label: string;
  /** The file extensions it reads, without the dot, in any case (`gcs`). At least one. */
  extensions: string[];
  /** Reads one file; may be async. A throw fails that file only, with its message in the summary. */
  parse(bytes: ArrayBuffer, fileName: string): ImportedCharacter | Promise<ImportedCharacter>;
}
