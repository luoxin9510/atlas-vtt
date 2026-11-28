/**
 * Importing character files (P3c decisions 26, 27, 32): per file the importer by extension reads
 * it, a PNG/JPG/WebP portrait becomes a token of the collection, the note goes into the
 * collection's `characters/` folder with the import record, and the whole run ends in one summary.
 * Everything that touches the vault is a dependency, so the flow is tested without one.
 *
 * What the importer hands over is checked first (`validatedCharacter`, and the template must exist).
 *
 * Choices: a file whose path the host could not tell still imports, its record's source empty, so
 * it never counts as "the same source" and a re-import asks for the file. A character without a
 * (supported) portrait gets a note and no token: Atlas has no default token art. The image is
 * written and the token registered before the note, which then links to the token; when the note
 * cannot be created the token is removed again (the image file stays).
 */

import type { FieldValue } from '../statblocks/model/templateTypes';
import { collectionFolderPath } from '../services/assetPaths';
import { t } from '../i18n';
import type { PickedFile } from './characterFiles';
import { emptySummary, summaryText, type ImportSummary } from './importSummary';
import { importerById, importerFor, importerIds } from './importerRegistry';
import type { CharacterImporter, ImportedCharacter } from './importerTypes';
import { IMPORT_RECORD_KEY, type ImportRecord } from './importRecord';
import { portraitProblem } from './portraitFormat';
import { validatedCharacter } from './validateImported';

export type ReimportOutcome = 'updated' | 'unchanged' | 'cancelled';

/** What a re-import (task 4) needs: the note, and the file read afresh by its importer. */
export interface ReimportRequest {
  notePath: string;
  collection: string;
  importer: CharacterImporter;
  source: PickedFile;
  character: ImportedCharacter;
}

export interface NewCharacterNote {
  name: string;
  templateId: string;
  /** The collection's `characters` folder. */
  folder: string;
  /** The token whose art is the note's image; the token is linked to the note. */
  tokenImagePath?: string | undefined;
  /** The imported values and the import record. */
  values: Record<string, FieldValue>;
}

export interface ImportDeps {
  /** Asks for files of these extensions; none when cancelled. */
  pickFiles(extensions: readonly string[]): Promise<PickedFile[]>;
  /** The collection to import into; null when cancelled (or when there is none, which the app says). */
  chooseCollection(): Promise<string | null>;
  /** Whether a statblock template of this id exists (the library is waited for). */
  templateExists(templateId: string): Promise<boolean>;
  /** The path of a note of the collection that records this importer and source; null for none. */
  findImportedNote(collection: string, importerId: string, source: string): string | null;
  /** "Already imported, re-import?"; false for No or a dismissed dialog. */
  confirmReimport(characterName: string): Promise<boolean>;
  reimport(request: ReimportRequest): Promise<ReimportOutcome>;
  /** Writes the portrait into Atlas' assets and returns its path. */
  writeImage(name: string, bytes: ArrayBuffer): Promise<string>;
  /** Registers the image as a token of the collection's library; returns the token's id. */
  addTokenAsset(asset: { name: string; imagePath: string; collection: string }): Promise<string>;
  /** Removes a token added by `addTokenAsset` (when the note could not be created); the image file stays. */
  removeTokenAsset(id: string): Promise<void>;
  /** Creates the statblock note and links the token; returns the note's path. */
  createNote(note: NewCharacterNote): Promise<string>;
  notify(message: string): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The extensions the registered importers read: lower case, without dots, each once. */
function registeredExtensions(): string[] {
  const all = importerIds().flatMap((id) => importerById(id)?.extensions ?? []);
  return [...new Set(all.map((extension) => extension.replace(/^\./, '').toLowerCase()))];
}

/** The portrait made a token of the collection, or null when there is none to keep. */
async function keepPortrait(character: ImportedCharacter, collection: string, deps: ImportDeps, summary: ImportSummary): Promise<{ imagePath: string; tokenId: string } | null> {
  const bytes = character.portrait?.bytes;
  if (!bytes) return null;
  const problem = portraitProblem(bytes);
  if (problem !== null) {
    (problem === 'tooBig' ? summary.oversizedPortrait : summary.unsupportedPortrait).push(character.name);
    return null;
  }
  const imagePath = await deps.writeImage(character.name, bytes);
  const tokenId = await deps.addTokenAsset({ name: character.name, imagePath, collection });
  return { imagePath, tokenId };
}

async function createNew(importer: CharacterImporter, file: PickedFile, character: ImportedCharacter, collection: string, deps: ImportDeps, summary: ImportSummary): Promise<void> {
  const portrait = await keepPortrait(character, collection, deps, summary);
  const record: ImportRecord = { importer: importer.id, source: file.path ?? '', keys: Object.keys(character.values) };
  try {
    await deps.createNote({
      name: character.name,
      templateId: character.templateId,
      folder: `${collectionFolderPath(collection)}/characters`,
      tokenImagePath: portrait?.imagePath,
      values: { ...character.values, [IMPORT_RECORD_KEY]: { importer: record.importer, source: record.source, keys: record.keys } },
    });
  } catch (error) {
    // A failed file leaves no token in the library; the image file may stay (nothing else refers to it, and a retry writes its own).
    if (portrait) await deps.removeTokenAsset(portrait.tokenId).catch(() => undefined);
    throw error;
  }
  summary.imported++;
}

async function reimportExisting(notePath: string, importer: CharacterImporter, file: PickedFile, character: ImportedCharacter, collection: string, deps: ImportDeps, summary: ImportSummary): Promise<void> {
  if (!(await deps.confirmReimport(character.name))) {
    summary.skipped++;
    return;
  }
  const outcome = await deps.reimport({ notePath, collection, importer, source: file, character });
  if (outcome === 'updated') summary.updated++;
  else summary.skipped++;
}

async function importFile(file: PickedFile, collection: string, deps: ImportDeps, summary: ImportSummary): Promise<void> {
  const importer = importerFor(file.fileName);
  if (!importer) {
    summary.failed.push({ name: file.fileName, reason: t('importers.noImporter') });
    return;
  }
  let character: ImportedCharacter;
  try {
    character = validatedCharacter(await importer.parse(file.bytes, file.fileName));
  } catch (error) {
    summary.failed.push({ name: file.fileName, reason: messageOf(error) });
    return;
  }
  const existing = file.path === null ? null : deps.findImportedNote(collection, importer.id, file.path);
  // A re-import keeps the note's own template (decision 30), so only a new note needs the importer's.
  if (existing === null && !(await deps.templateExists(character.templateId))) {
    summary.failed.push({ name: file.fileName, reason: t('importers.invalid.templateMissing', { id: character.templateId }) });
    return;
  }
  try {
    if (existing === null) await createNew(importer, file, character, collection, deps, summary);
    else await reimportExisting(existing, importer, file, character, collection, deps, summary);
  } catch (error) {
    summary.failed.push({ name: character.name, reason: messageOf(error) });
  }
}

/** Runs the import command: pick, choose the collection, import file by file, then one summary. */
export async function importCharacterFiles(deps: ImportDeps): Promise<void> {
  const extensions = registeredExtensions();
  if (extensions.length === 0) return;
  const files = await deps.pickFiles(extensions);
  if (files.length === 0) return;
  const collection = await deps.chooseCollection();
  if (collection === null) return;
  const summary = emptySummary();
  for (const file of files) await importFile(file, collection, deps, summary);
  deps.notify(summaryText(summary));
}
