import { TFile, type App, type TAbstractFile } from 'obsidian';
import { QuestImages } from '../../../plugin/questImages';
import { isRecord, MAX_ASSET_BYTES, parsePlayerMessage, TEXT_MIME_TYPE, type GmMessage, type PlayerMessage } from '../../protocol/index.ts';
import { NOTES_LEVEL, type NotesMessage, type SharedNote } from '../../protocol/fork.ts';
import { AssetAnswers, type AssetAnswerPorts } from '../assetAnswers.ts';
import { assetTag, sha256Hex } from '../assetServe.ts';
import type { ScaleImage } from '../assetVariants.ts';
import type { VaultImage } from '../TokenShare.ts';
import { parseNote } from './parseNote';
import { copyForPlayers } from './playerCopy';
import { HeldHashes } from './heldHashes.ts';
import { watchVault } from './notesWatch.ts';
import { readFlag, SharedSet, type Entry } from './sharedNotes.ts';

export interface NotesSharePorts {
  app: App;
  /** The players online now. */
  players(): readonly string[];
  /** The fork level a player's app declared; 0 when none. */
  levelOf(player: string): number;
  send(body: GmMessage, to: string, tag?: string): void;
  dropTagged(tag: string): void;
  /** A new note id: 24 lowercase hex characters. */
  randomId(): string;
  now(): number;
  tickets?: AssetAnswerPorts['tickets'];
  images: QuestImages;
  readImage(path: string): Promise<VaultImage | null>;
  scaleImage?: ScaleImage | undefined;
  /** The most bytes a copy may take (`MAX_ASSET_BYTES` when unset); a larger note is not shared. */
  maxBytes?: number;
  /** Called after each publish: the count or the cap may have changed. */
  changed?: () => void;
}

const EMPTY_LIST = JSON.stringify({ t: 'notes', notes: [] });

/**
 * The notes the GM shares with players: every note whose frontmatter says `atlas-share: true`, as a copy
 * (`copyForPlayers`) kept in memory and followed as the vault changes. Level-3 players are sent the list
 * and fetch each text (socket chunks) and image by hash. A hash that leaves the set (a note unshared,
 * edited, renamed out, deleted, an image no longer named) has its queued chunks dropped and is refused
 * from then on. Nothing here logs: titles, groups, paths and texts belong to the GM.
 */
export class NotesShare {
  private readonly ports: NotesSharePorts;
  private readonly set: SharedSet;
  private readonly answers: AssetAnswers;
  private readonly entries = new Map<string, Entry>();
  /** Reads under way by note, with the links they began from; the last to start wins. */
  /** Notes that could not be copied, by the state of their source: the same state is not read again. */
  private readonly failed = new Map<string, string>();
  private readonly building = new Map<string, string>();
  private readonly turns = new Map<string, number>();
  private pending = 0;
  private epoch = 0;
  private readonly hashes = new HeldHashes();
  private lastList = EMPTY_LIST;
  private unwatch: () => void = () => undefined;

  constructor(ports: NotesSharePorts) {
    this.ports = ports;
    this.set = new SharedSet(() => ports.randomId());
    this.answers = new AssetAnswers(
      { send: (body, to, tag) => ports.send(body, to, tag), now: () => ports.now(), readImage: (path) => ports.readImage(path), scaleImage: ports.scaleImage, tickets: ports.tickets, levelOf: (player) => ports.levelOf(player) },
      {
        map: () => null,
        explored: () => undefined,
        artPath: (hash) => this.imagePath(hash),
        text: (hash) => this.textBytes(hash),
      },
    );
  }

  /** The notes listed now. */
  get count(): number {
    return this.listEntries().length;
  }

  /** More notes are flagged than the list holds: the rest are not shared. */
  get capped(): boolean {
    return this.set.capped;
  }

  start(): void {
    this.unwatch();
    this.unwatch = watchVault(this.ports.app, {
      changed: (file) => this.noteChanged(file),
      deleted: (path) => this.noteDeleted(path),
      resolved: () => this.sync(new Set()),
      image: (file) => this.imageChanged(file),
      renamed: (file, oldPath) => this.renamed(file, oldPath),
    });
    for (const file of this.ports.app.vault.getMarkdownFiles()) this.set.set(file.path, readFlag(this.ports.app, file));
    this.sync(new Set(this.set.flagged()));
  }

  stop(): void {
    this.epoch++;
    this.unwatch();
    this.unwatch = () => undefined;
    this.entries.clear();
    this.building.clear();
    this.failed.clear();
    this.hashes.clear();
    this.lastList = EMPTY_LIST;
    this.ports.images.retain(new Set());
  }

  /** The list again, to one player or to all. */
  resend(to?: string): void {
    for (const player of to === undefined ? this.ports.players() : [to]) this.client(player);
  }

  /** A player's app declared its level: it is sent the list when it can read it. */
  client(player: string): void {
    if (this.ports.levelOf(player) >= NOTES_LEVEL) this.ports.send(this.message(), player);
  }

  /** A player's message: a request for a hash this share holds (answered) or held (refused); false for any other, which the others read. */
  receive(from: string, body: unknown): boolean {
    if (!isRecord(body) || body.t !== 'asset-request') return false;
    const message: PlayerMessage | null = parsePlayerMessage(body);
    if (message?.t !== 'asset-request' || this.ports.levelOf(from) < NOTES_LEVEL) return false;
    if (this.hashes.has(message.hash)) {
      this.answers.answer(from, message);
      return true;
    }
    if (!this.hashes.wasHeld(message.hash)) return false;
    this.ports.send({ t: 'asset-refused', hash: message.hash }, from);
    return true;
  }

  /** A player left the table: chunks queued for them are dropped, so they may ask again at once. */
  playerLeft(player: string): void {
    this.answers.forget(player);
  }

  private noteChanged(file: TFile): void {
    if (file.extension !== 'md') return;
    const before = this.set.isFlagged(file.path);
    this.set.set(file.path, readFlag(this.ports.app, file));
    // A note that was not flagged and is not now changes nothing for anyone else.
    if (before || this.set.isFlagged(file.path)) this.sync(new Set([file.path]));
  }

  private noteDeleted(path: string): void {
    this.set.forget(path);
    this.sync(new Set());
  }

  private renamed(file: TAbstractFile, oldPath: string): void {
    this.set.move(oldPath, file.path);
    // A new name is a new title.
    if (file instanceof TFile && file.extension === 'md') this.set.set(file.path, readFlag(this.ports.app, file));
    for (const map of [this.entries, this.building, this.turns] as ReadonlyArray<Map<string, unknown>>) {
      for (const [path, value] of [...map]) {
        if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
        map.delete(path);
        map.set(file.path + path.slice(oldPath.length), value);
      }
    }
    const moved = this.set.flagged().filter((path) => path === file.path || path.startsWith(`${file.path}/`));
    this.sync(new Set(moved));
    this.imageChanged(file);
  }

  /** An image may be one a shared note embeds, or one it names that was not there before: notes with embeds are read again. */
  private imageChanged(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension === 'md') return;
    this.sync(new Set([...this.entries].filter(([, entry]) => entry.embeds).map(([path]) => path)));
  }

  /** Brings the entries in step with the shared set: those that left go now, those new, changed or whose links changed are read. */
  private sync(dirty: ReadonlySet<string>): void {
    const shared = this.set.paths();
    const listed = new Set(shared);
    let removed = false;
    for (const path of [...this.entries.keys(), ...this.building.keys()]) {
      if (listed.has(path)) continue;
      removed ||= this.entries.delete(path);
      this.building.delete(path);
      this.turns.set(path, (this.turns.get(path) ?? 0) + 1);
    }
    const links = this.ports.app.metadataCache.resolvedLinks;
    const reads: Array<readonly [string, string]> = [];
    for (const path of shared) {
      const key = this.linkKey(links[path] ?? {});
      if (dirty.has(path)) this.failed.delete(path);
      else if (this.failed.get(path) === this.stamp(path, key)) continue;
      const entry = this.entries.get(path);
      const reading = this.building.get(path);
      // A note that links to one whose state changed may still name it: its copy is withdrawn until it is read again.
      if (entry !== undefined && entry.linkKey !== key) removed = this.entries.delete(path) || removed;
      if (dirty.has(path) || (reading !== undefined ? reading !== key : entry?.linkKey !== key)) reads.push([path, key]);
    }
    if (removed) this.settle();
    for (const [path, key] of reads) void this.build(path, key);
    if (removed) this.publish();
  }

  /** The state of a note's source and links, which a failed read is remembered by. */
  private stamp(path: string, key: string): string {
    const file = this.ports.app.vault.getFileByPath(path);
    return `${file?.stat.mtime}\n${file?.stat.size}\n${key}`;
  }

  /** A note that cannot be copied is not shared until a later read succeeds: what it had is withdrawn at once. */
  private fail(path: string, turn: number, epoch: number, key: string): void {
    if (this.turns.get(path) !== turn || this.epoch !== epoch) return;
    this.failed.set(path, this.stamp(path, key));
    if (!this.entries.delete(path)) return;
    this.settle();
    this.publish();
  }

  /** What the note's resolved links lead to now, as shared notes: a change reads the note again. */
  private linkKey(links: Readonly<Record<string, number>>): string {
    return Object.keys(links).sort().map((target) => {
      const info = this.set.info(target);
      return info === undefined ? `${target}:-` : `${target}:${info.id}:${info.title}`;
    }).join('\n');
  }

  private async build(path: string, key: string): Promise<void> {
    const turn = (this.turns.get(path) ?? 0) + 1;
    const epoch = this.epoch;
    this.turns.set(path, turn);
    this.building.set(path, key);
    this.pending++;
    try {
      const { app } = this.ports;
      const file = app.vault.getFileByPath(path);
      const info = this.set.info(path);
      if (file === null || info === undefined) return;
      const source = await app.vault.read(file);
      const resolved = new Map<string, string>();
      const copy = await copyForPlayers(parseNote(source), {
        note: (linkpath) => this.noteTarget(linkpath, path),
        image: async (linkpath) => {
          const image = this.ports.images.resolve(path, [{ target: linkpath, width: null, height: null }])[0];
          const ref = image === undefined ? null : await this.ports.images.refOf(image.file);
          if (image !== undefined && ref !== null) resolved.set(ref.hash, image.file.path);
          return ref;
        },
      });
      const bytes = new TextEncoder().encode(copy.markdown).slice();
      if (bytes.length > (this.ports.maxBytes ?? MAX_ASSET_BYTES)) return this.fail(path, turn, epoch, key);
      const ref = { hash: await sha256Hex(bytes), size: bytes.length, mime: TEXT_MIME_TYPE };
      if (this.turns.get(path) !== turn || this.epoch !== epoch || this.set.info(path)?.id !== info.id) return;
      const images = new Map<string, string>();
      for (const hash of copy.images.keys()) {
        const imagePath = resolved.get(hash);
        if (imagePath !== undefined) images.set(hash, imagePath);
      }
      this.entries.set(path, { id: info.id, title: info.title, group: info.group, ref, bytes, images, linkKey: key, embeds: source.includes('![') });
      this.settle();
    } catch {
      // Nothing is logged: it would name the note.
      this.fail(path, turn, epoch, key);
    } finally {
      if (this.turns.get(path) === turn) this.building.delete(path);
      this.pending--;
      if (this.pending === 0 && this.epoch === epoch) this.publish();
    }
  }

  private noteTarget(linkpath: string, from: string): { id: string; title: string } | null {
    const file = this.ports.app.metadataCache.getFirstLinkpathDest(linkpath, from);
    const info = file === null ? undefined : this.set.info(file.path);
    return info === undefined ? null : { id: info.id, title: info.title };
  }

  private listEntries(): Array<{ readonly path: string; readonly entry: Entry }> {
    return this.set.paths().flatMap((path) => {
      const entry = this.entries.get(path);
      return entry === undefined ? [] : [{ path, entry }];
    });
  }

  private message(): NotesMessage {
    const notes: SharedNote[] = this.listEntries().map(({ entry }) => ({
      id: entry.id, title: entry.title, ...(entry.group === null ? {} : { group: entry.group }), text: entry.ref,
    }));
    return { t: 'notes', notes };
  }

  /** Sends the list to the players who can read it when it differs from the one sent last. */
  private publish(): void {
    const message = this.message();
    const json = JSON.stringify(message);
    this.ports.changed?.();
    if (json === this.lastList) return;
    this.lastList = json;
    for (const player of this.ports.players()) if (this.ports.levelOf(player) >= NOTES_LEVEL) this.ports.send(message, player);
  }

  /** The hashes held change: queued chunks of those that left are dropped and later requests for them refused. */
  private settle(): void {
    const now = new Set<string>();
    for (const { entry } of this.listEntries()) {
      now.add(entry.ref.hash);
      for (const hash of entry.images.keys()) now.add(hash);
    }
    const left = this.hashes.replace(now);
    for (const hash of left) this.ports.dropTagged(assetTag(hash));
    if (left.length > 0) this.answers.forget();
    this.ports.images.retain(new Set(this.listEntries().flatMap(({ entry }) => [...entry.images.values()])));
  }

  private textBytes(hash: string): Uint8Array | undefined {
    return this.listEntries().find(({ entry }) => entry.ref.hash === hash)?.entry.bytes;
  }

  private imagePath(hash: string): string | undefined {
    for (const { entry } of this.listEntries()) {
      const path = entry.images.get(hash);
      if (path !== undefined) return path;
    }
    return undefined;
  }
}
