/**
 * Reading character files from disk (P3c decisions 13 and 25): the system file picker yields the
 * bytes and, on the desktop, the file's absolute path, which the import record keeps so a
 * re-import reads the file again without asking. Atlas is desktop-only, so Electron and node `fs`
 * are there; they are reached through one small host (`CharacterFileHost`) that tests replace.
 */

import type { ImportRecord } from './importRecord';

export interface PickedFile {
  /** The absolute path; null where the host cannot say (a re-import then asks for the file again). */
  path: string | null;
  fileName: string;
  bytes: ArrayBuffer;
}

/** The two things only the desktop can do. */
export interface CharacterFileHost {
  /** The absolute path of a picked file; null when unknown. */
  pathOf(file: File): string | null;
  /** The bytes at a path; null when the file is missing. May reject for other read errors. */
  read(path: string): Promise<ArrayBuffer | null>;
}

interface NodeRequire {
  (module: string): unknown;
}

/**
 * Obsidian hands the plugin `window.require`; both modules are fetched when first used, never
 * imported at the top of a file, so the bundle stays free of them (they are externals anyway).
 */
function desktopRequire(): NodeRequire | null {
  if (typeof activeWindow === 'undefined') return null;
  const found = (activeWindow as { require?: unknown }).require;
  return typeof found === 'function' ? (found as NodeRequire) : null;
}

/** The host of the running app: Electron's `webUtils` for paths, `fs/promises` for reads. */
export function desktopHost(): CharacterFileHost {
  return {
    pathOf(file: File): string | null {
      try {
        const electron = desktopRequire()?.('electron') as { webUtils?: { getPathForFile?: (file: File) => string } } | undefined;
        const path = electron?.webUtils?.getPathForFile?.(file);
        return typeof path === 'string' && path !== '' ? path : null;
      } catch {
        return null;
      }
    },
    async read(path: string): Promise<ArrayBuffer | null> {
      const fs = desktopRequire()?.('fs/promises') as { readFile?: (path: string) => Promise<Uint8Array> } | undefined;
      if (!fs?.readFile) return null;
      const data = await fs.readFile(path);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    },
  };
}

/** The `accept` attribute for the registered extensions: `.gcs,.json`, lower case, once each. */
export function acceptOf(extensions: readonly string[]): string {
  const dotted = extensions.map((extension) => `.${extension.replace(/^\./, '').toLowerCase()}`);
  return [...new Set(dotted)].join(',');
}

async function toPicked(file: File, host: CharacterFileHost): Promise<PickedFile> {
  return { path: host.pathOf(file), fileName: file.name, bytes: await file.arrayBuffer() };
}

function pick(doc: Document, extensions: readonly string[], host: CharacterFileHost, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const attr: Record<string, string> = { accept: acceptOf(extensions) };
    if (multiple) attr.multiple = '';
    const input = doc.body.createEl('input', { type: 'file', cls: 'atlas-hidden-file-input', attr });
    // Closing the dialog fires `cancel` (Chromium, so Electron); a window that never reports it
    // leaves the promise pending and nothing else, since the person can simply ask again.
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      Promise.all(files.map((file) => toPicked(file, host))).then(resolve, reject);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    input.click();
  });
}

/** Asks for character files in the window of `doc`; resolves to none when the person cancels. */
export function pickCharacterFiles(doc: Document, extensions: readonly string[], host: CharacterFileHost = desktopHost()): Promise<PickedFile[]> {
  return pick(doc, extensions, host, true);
}

/**
 * Whether a recorded source is a local absolute path: `/Users/me/a.gcs` or `C:\\Users\\me\\a.gcs`. A
 * note is data from anywhere (a shared vault), so a path that names another machine (`\\\\host\\share`,
 * `//host/share`), a url or a relative path is never read: reading it would reach out to the network.
 */
export function isLocalAbsolutePath(path: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  return path.startsWith('/') && !path.startsWith('//');
}

/** The bytes of a file at a path; null when it is no local absolute path, is missing or cannot be read, never throws. */
export async function readCharacterSource(path: string, host: CharacterFileHost = desktopHost()): Promise<ArrayBuffer | null> {
  if (!isLocalAbsolutePath(path)) return null;
  try {
    return await host.read(path);
  } catch {
    return null;
  }
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/**
 * The source of a re-import: the recorded path when it still reads, else the person is asked for
 * one file (the caller records its new path); null when they cancel.
 */
export async function findOrAskSource(
  record: Pick<ImportRecord, 'source'>,
  doc: Document,
  extensions: readonly string[],
  host: CharacterFileHost = desktopHost(),
): Promise<PickedFile | null> {
  const bytes = await readCharacterSource(record.source, host);
  if (bytes) return { path: record.source, fileName: baseName(record.source), bytes };
  const [file] = await pick(doc, extensions, host, false);
  return file ?? null;
}
