import type { App, TFile } from 'obsidian';
import type { AssetRef } from '../../protocol/index.ts';
import { MAX_SHARED_NOTES } from '../../protocol/fork.ts';
import { bookLine } from '../../protocol/bookText.ts';

const MAX_TITLE = 120;
const MAX_GROUP = 60;

/** What a flagged note is listed as: its cleaned title and, where it has one, its group. */
export interface Flag {
  readonly title: string;
  readonly group: string | null;
}

/** A shared note as the share knows it. */
export interface SharedInfo extends Flag {
  readonly id: string;
}

/**
 * Whether the note's frontmatter shares it (`atlas-share` exactly `true`) and how it is listed. Null for
 * a note that is not shared, and for one whose file name cannot be shown as a title.
 */
export function readFlag(app: App, file: TFile): Flag | null {
  const frontmatter: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
  if (frontmatter?.['atlas-share'] !== true) return null;
  const title = bookLine(file.basename, MAX_TITLE);
  if (title === null) return null;
  const group = bookLine(frontmatter['atlas-share-group'], MAX_GROUP);
  return { title, group };
}

/** A shared note's player copy as it is kept: what the list says of it, its bytes, and what it names. */
export interface Entry {
  readonly id: string;
  readonly title: string;
  readonly group: string | null;
  readonly ref: AssetRef;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** The images the copy names: hash to the vault path they are served from. */
  readonly images: ReadonlyMap<string, string>;
  /** What the note's links resolved to when it was read: a change reads it again. */
  readonly linkKey: string;
  /** The `${id}:${title}` of the shared notes its links named: one gone or retitled withdraws the copy. */
  readonly shown: ReadonlySet<string>;
  /** Whether the note embeds images, which a change of the vault's images may affect. */
  readonly embeds: boolean;
}

/** Whether `path` is `folder` or lies inside it. */
const isWithin = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** Moves the keys at or inside `from` to `to` in each map. */
export function moveKeys(maps: ReadonlyArray<Map<string, unknown>>, from: string, to: string): void {
  for (const map of maps) {
    for (const [path, value] of [...map]) {
      if (!isWithin(path, from)) continue;
      map.delete(path);
      map.set(to + path.slice(from.length), value);
    }
  }
}

/**
 * The notes flagged for sharing, and which of them are shared: the first `MAX_SHARED_NOTES` by title
 * (`localeCompare`, ties by path). A note keeps its id from the first time it is shared until it is deleted,
 * and the id follows its renames.
 */
export class SharedSet {
  private readonly flags = new Map<string, Flag>();
  private readonly ids = new Map<string, string>();
  private listed: { readonly order: readonly string[]; readonly infos: ReadonlyMap<string, SharedInfo> } | null = null;

  constructor(private readonly randomId: () => string) {}

  /** Sets (or, with null, clears) a note's flag; whether anything changed. */
  set(path: string, flag: Flag | null): boolean {
    const known = this.flags.get(path);
    if (known?.title === flag?.title && known?.group === flag?.group) return false;
    if (flag === null) this.flags.delete(path);
    else this.flags.set(path, flag);
    this.listed = null;
    return true;
  }

  /** A note was deleted: its flag and id go. */
  forget(path: string): void {
    this.set(path, null);
    this.ids.delete(path);
  }

  /** A note or a folder moved: the notes in it keep their ids and flags under their new paths. */
  move(from: string, to: string): void {
    moveKeys([this.flags, this.ids], from, to);
    this.listed = null;
  }

  /** Whether any note is flagged at `path`, shared or not. */
  isFlagged(path: string): boolean {
    return this.flags.has(path);
  }

  /** The paths of the flagged notes. */
  flagged(): string[] {
    return [...this.flags.keys()];
  }

  /** The paths of the shared notes, in the order they are listed. */
  paths(): readonly string[] {
    return this.list().order;
  }

  /** How a shared note is listed; undefined for a note that is not shared. */
  info(path: string): SharedInfo | undefined {
    return this.list().infos.get(path);
  }

  /** More notes are flagged than the list holds. */
  get capped(): boolean {
    return this.flags.size > MAX_SHARED_NOTES;
  }

  private list(): NonNullable<SharedSet['listed']> {
    if (this.listed !== null) return this.listed;
    const order = [...this.flags.entries()]
      .sort(([pathA, a], [pathB, b]) => a.title.localeCompare(b.title) || (pathA < pathB ? -1 : pathA > pathB ? 1 : 0))
      .slice(0, MAX_SHARED_NOTES)
      .map(([path]) => path);
    const infos = new Map<string, SharedInfo>();
    for (const path of order) {
      let id = this.ids.get(path);
      if (id === undefined) {
        id = this.randomId();
        this.ids.set(path, id);
      }
      infos.set(path, { id, ...(this.flags.get(path) as Flag) });
    }
    this.listed = { order, infos };
    return this.listed;
  }
}
