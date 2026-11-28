/**
 * Re-importing a character into its note (P3c decisions 15, 25, 28-31): the file is read again
 * (asking for it when it is gone), what would change is listed and written only after
 * confirmation. Only imported keys are replaced or removed; the note's template, body and other
 * keys stay, current damage is kept clamped to the new maxima, conditions are never touched, and a
 * changed portrait becomes a new image the linked token takes over (the old file stays).
 * Everything that touches the vault is a dependency, so the flow is tested without one.
 */

import { t } from '../i18n';
import type { FieldValue } from '../statblocks/model/templateTypes';
import type { PickedFile } from './characterFiles';
import { keepNoteCurrent } from './damageKept';
import { diffImport, type ImportChange } from './importDiff';
import { importableValues, isImportableKey } from './importNotePatches';
import type { ReimportOutcome } from './importCharacters';
import { readImportRecord, IMPORT_RECORD_KEY, type ImportRecord } from './importRecord';
import type { CharacterImporter, ImportedCharacter } from './importerTypes';
import { portraitFormat } from './portraitFormat';

export interface ReimportOptions {
  notePath: string;
  importer: CharacterImporter;
  /** The file read again; the recorded path, or the person is asked, when not given. */
  source?: PickedFile;
  /** The file already parsed (the import command did); parsed here when not given. */
  character?: ImportedCharacter;
}

/** What goes into the note: values set, keys removed, and the renewed record. */
export interface NoteEdit {
  set: Record<string, FieldValue>;
  remove: string[];
  record: ImportRecord;
}

export interface ReimportPreview {
  name: string;
  changes: ImportChange[];
  /** Whether the portrait is replaced by a new image. */
  portrait: boolean;
}

export interface PlacedTokensUpdate {
  notePath: string;
  /** The note's keys after the re-import, and the keys it no longer has. */
  after: Record<string, FieldValue>;
  removed: string[];
  /** The portrait placed tokens used and the one that replaces it; null when it stays. */
  oldImage: string | null;
  newImage: string | null;
}

export interface ReimportDeps {
  /** The note's properties as they are now; null when the note is gone. */
  readFrontmatter(notePath: string): Promise<Record<string, FieldValue> | null>;
  /** Asks for the file when the recorded path no longer reads; null when cancelled. */
  askSource(record: ImportRecord, extensions: readonly string[]): Promise<PickedFile | null>;
  /** The list of changes; false when the person cancels. */
  confirmChanges(preview: ReimportPreview): Promise<boolean>;
  writeNote(notePath: string, edit: NoteEdit): Promise<void>;
  /** The image of the token asset linked to the note; null when none. */
  linkedImage(notePath: string): Promise<string | null>;
  readImage(path: string): Promise<ArrayBuffer | null>;
  /** Writes the portrait into Atlas' assets as a new file and returns its path. */
  writeImage(name: string, bytes: ArrayBuffer): Promise<string>;
  /** Points the linked token asset (and the note's picture) at the new image. */
  swapPortrait(swap: { notePath: string; oldImage: string; newImage: string }): Promise<void>;
  /** Registers the image as a token of the collection and links it to the note. */
  addLinkedToken(token: { name: string; imagePath: string; collection: string; notePath: string }): Promise<void>;
  collectionOf(notePath: string): string | null;
  /** Placed tokens linked to the note: damage kept against the new maxima, the new image. */
  updatePlacedTokens(update: PlacedTokensUpdate): Promise<void>;
  notify(message: string): void;
}

const sameBytes = (a: ArrayBuffer, b: ArrayBuffer): boolean => {
  const [x, y] = [new Uint8Array(a), new Uint8Array(b)];
  return x.length === y.length && x.every((byte, at) => byte === y[at]);
};

/** The portrait the file gives when it is one Atlas keeps and differs from the linked token's image. */
async function newPortrait(character: ImportedCharacter, linked: string | null, deps: ReimportDeps): Promise<ArrayBuffer | null> {
  const bytes = character.portrait?.bytes;
  if (!bytes || !portraitFormat(bytes)) return null;
  const old = linked === null ? null : await deps.readImage(linked);
  return old !== null && sameBytes(old, bytes) ? null : bytes;
}

/** The values the note ends with: its own, minus the removed keys, with the imported ones over them. */
function afterValues(frontmatter: Readonly<Record<string, FieldValue>>, set: Readonly<Record<string, FieldValue>>, removed: readonly string[], record: ImportRecord): Record<string, FieldValue> {
  const after: Record<string, FieldValue> = { ...frontmatter, ...set };
  for (const key of removed) delete after[key];
  after[IMPORT_RECORD_KEY] = { importer: record.importer, source: record.source, keys: [...record.keys] };
  return after;
}

async function parsedCharacter(options: ReimportOptions, source: PickedFile): Promise<ImportedCharacter> {
  return options.character ?? options.importer.parse(source.bytes, source.fileName);
}

/**
 * Re-imports the character into the note. A parse error or a failing write rejects (the caller
 * reports it as a failure); 'unchanged' also covers a re-import that only renews the source path.
 */
export async function reimportCharacter(deps: ReimportDeps, options: ReimportOptions): Promise<ReimportOutcome> {
  const { notePath, importer } = options;
  const frontmatter = await deps.readFrontmatter(notePath);
  if (!frontmatter) throw new Error(t('importers.noteMissing', { path: notePath }));
  const recorded = readImportRecord(frontmatter) ?? { importer: importer.id, source: '', keys: [] };

  const source = options.source ?? await deps.askSource(recorded, importer.extensions);
  if (!source) return 'cancelled';
  const character = await parsedCharacter(options, source);

  const imported = importableValues(keepNoteCurrent(frontmatter, character.values));
  const changes = diffImport(frontmatter, imported, recorded.keys.filter(isImportableKey));
  const removed = changes.filter((change) => change.kind === 'removed').map((change) => change.key);
  const record: ImportRecord = { importer: importer.id, source: source.path ?? recorded.source, keys: Object.keys(character.values) };
  const linked = await deps.linkedImage(notePath);
  const portrait = await newPortrait(character, linked, deps);

  if (changes.length === 0 && portrait === null) {
    if (record.source !== recorded.source) await deps.writeNote(notePath, { set: {}, remove: [], record: { ...recorded, source: record.source } });
    deps.notify(t('importers.upToDate'));
    return 'unchanged';
  }
  if (!(await deps.confirmChanges({ name: character.name, changes, portrait: portrait !== null }))) return 'cancelled';

  let newImage: string | null = null;
  if (portrait !== null) {
    newImage = await deps.writeImage(character.name, portrait);
    const collection = deps.collectionOf(notePath);
    if (linked !== null) await deps.swapPortrait({ notePath, oldImage: linked, newImage });
    else if (collection !== null) await deps.addLinkedToken({ name: character.name, imagePath: newImage, collection, notePath });
  }
  await deps.writeNote(notePath, { set: imported, remove: removed, record });
  await deps.updatePlacedTokens({ notePath, after: afterValues(frontmatter, imported, removed, record), removed, oldImage: linked, newImage });
  return 'updated';
}
