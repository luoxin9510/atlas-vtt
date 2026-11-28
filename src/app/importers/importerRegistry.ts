/**
 * The character importers rule packs registered. Like the rule registries, each id keeps a stack: the
 * last registered importer of an id decides, and a removed one is gone for good. A file is read by the
 * most recently registered importer that names its extension.
 */

import type { CharacterImporter } from './importerTypes';

/** Every live registration, oldest first. */
const registrations: CharacterImporter[] = [];

/** The importers that decide: the last registration of each id, in registration order. */
function active(): CharacterImporter[] {
  return registrations.filter((importer, at) => registrations.findLastIndex((other) => other.id === importer.id) === at);
}

/** The extension of a file name (after its last dot), lower case; empty when it has none. */
function extensionOf(fileName: string): string {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

const normalized = (extension: string): string => extension.replace(/^\./, '').toLowerCase();

/**
 * Registers `importer`, replacing an importer of its id. Returns a function that removes it again:
 * the one it replaced comes back only while it is still registered itself, so a removed importer
 * never returns, whatever the order of the removals.
 */
export function registerImporter(importer: CharacterImporter): () => void {
  registrations.push(importer);
  return (): void => {
    const at = registrations.indexOf(importer);
    if (at >= 0) registrations.splice(at, 1);
  };
}

/** The importer that reads files named like `fileName`: the latest of those naming its extension; undefined for none. */
export function importerFor(fileName: string): CharacterImporter | undefined {
  const extension = extensionOf(fileName);
  if (extension === '') return undefined;
  return active().findLast((importer) => importer.extensions.some((own) => normalized(own) === extension));
}

/** The importer registered under `id`, or undefined. */
export function importerById(id: string): CharacterImporter | undefined {
  return registrations.findLast((importer) => importer.id === id);
}

/** The ids of the registered importers, in registration order. */
export function importerIds(): string[] {
  return active().map((importer) => importer.id);
}
