import type { App, TAbstractFile, TFile } from 'obsidian';

/** What the vault tells the share of. */
export interface NoteEvents {
  /** A note's metadata changed. */
  changed(file: TFile): void;
  /** A note's metadata is gone. */
  deleted(path: string): void;
  /** Link targets may have changed. */
  resolved(): void;
  /** A file other than a note was modified, created or deleted. */
  image(file: TAbstractFile): void;
  renamed(file: TAbstractFile, oldPath: string): void;
}

/** Listens to the vault and its metadata cache; returns the function that takes every listener off again. */
export function watchVault(app: App, events: NoteEvents): () => void {
  const { vault, metadataCache } = app;
  const meta = [
    metadataCache.on('changed', (file) => events.changed(file)),
    metadataCache.on('deleted', (file) => events.deleted(file.path)),
    metadataCache.on('resolved', () => events.resolved()),
  ];
  const files = [
    vault.on('modify', (file) => events.image(file)), vault.on('create', (file) => events.image(file)), vault.on('delete', (file) => events.image(file)),
    vault.on('rename', (file, oldPath) => events.renamed(file, oldPath)),
  ];
  return () => {
    for (const ref of meta) metadataCache.offref(ref);
    for (const ref of files) vault.offref(ref);
  };
}
