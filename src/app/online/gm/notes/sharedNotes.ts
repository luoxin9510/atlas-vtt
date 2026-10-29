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
  /** The same pairs for the notes the copy actually linked (the copy's own resolution): one gone or retitled withdraws the copy too. */
  readonly linked: ReadonlySet<string>;
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

  /** The `${id}:${title}` of every shared note: what a copy's `linked` pairs must still be among. */
  heldPairs(): ReadonlySet<string> {
    const held = new Set<string>();
    for (const info of this.list().infos.values()) held.add(`${info.id}:${info.title}`);
    return held;
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

/** The entry listed as `info` says: the same copy under a new title or group, or null when nothing differs. */
export function retitled(entry: Entry, info: SharedInfo): Entry | null {
  if (entry.title === info.title && entry.group === info.group) return null;
  return { ...entry, title: info.title, group: info.group };
}

/**
 * Lists the held entries of shared notes under the title and group the share has for them now, so a rename
 * shows before the copy is read again. Only notes in the shared set are looked at, so a title that is not
 * shared is never taken. Whether any entry changed.
 */
export function retitleHeld(entries: Map<string, Entry>, set: SharedSet): boolean {
  let changed = false;
  for (const path of set.paths()) {
    const entry = entries.get(path);
    const info = set.info(path);
    const next = entry === undefined || info === undefined ? null : retitled(entry, info);
    if (next === null) continue;
    entries.set(path, next);
    changed = true;
  }
  return changed;
}
