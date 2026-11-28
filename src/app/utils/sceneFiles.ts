import type { App, TFile } from 'obsidian';

/** Extension of Atlas scene files, the only files the Atlas view opens. */
export const EXTENSION_ATLASMAP = 'atlasmap';

/** Whether `path` names an Atlas scene file. */
export function isScenePath(path: string): boolean {
  return path.endsWith(`.${EXTENSION_ATLASMAP}`);
}

/** Every scene file of the vault. */
export function allSceneFiles(app: App): TFile[] {
  return app.vault.getFiles().filter((file) => isScenePath(file.path));
}
