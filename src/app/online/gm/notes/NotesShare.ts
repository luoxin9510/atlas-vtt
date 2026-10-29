import { TFile, type App, type TAbstractFile } from 'obsidian';
import { QuestImages } from '../../../plugin/questImages';
import { isRecord, MAX_ASSET_BYTES, parsePlayerMessage, TEXT_MIME_TYPE, type GmMessage, type PlayerMessage } from '../../protocol/index.ts';
import { NOTES_LEVEL } from '../../protocol/fork.ts';
import { AssetAnswers, type AssetAnswerPorts } from '../assetAnswers.ts';
import { companionTimers, type Timers } from '../companionTimers.ts';
import { sha256Hex } from '../assetServe.ts';
import type { ScaleImage } from '../assetVariants.ts';
import type { VaultImage } from '../TokenShare.ts';
import { copyNote } from './noteCopy.ts';
import { imagePath, listMessage, textBytes, type Listed } from './noteList.ts';
import { HeldHashes } from './heldHashes.ts';
import { NOTES_TAG_PREFIX, notesTag } from './notesTag.ts';
import { watchVault } from './notesWatch.ts';
import { FailedReads } from './failedReads.ts';
import { linkState, type LinkState } from './linkKey.ts';
import { moveKeys, readFlag, retitleHeld, SharedSet, type Entry } from './sharedNotes.ts';

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
  /** Schedules the retries of a failed read (`companionTimers()` when unset). */
  timers?: Timers | undefined;
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
  /** Notes that could not be copied, by the state of their source: the same state is not read again at once. */
  private readonly failed: FailedReads;
  /** Reads under way by note, with the links they began from; the last to start wins. */
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
    this.failed = new FailedReads(ports.timers ?? companionTimers(), () => this.sync(new Set()));
    this.answers = new AssetAnswers(
      { send: (body, to, tag) => ports.send(body, to, tag), now: () => ports.now(), readImage: (path) => ports.readImage(path), scaleImage: ports.scaleImage, tickets: ports.tickets, levelOf: (player) => ports.levelOf(player) },
      {
        map: () => null,
        explored: () => undefined,
        artPath: (hash) => imagePath(this.listEntries(), hash),
        text: (hash) => textBytes(this.listEntries(), hash),
      },
      NOTES_TAG_PREFIX,
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
    // Reads begun before this belong to the old epoch and no longer count.
    this.pending = 0;
    this.unwatch();
    this.unwatch = () => undefined;
    this.entries.clear();
    this.building.clear();
    this.failed.clearAll();
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
    if (this.ports.levelOf(player) >= NOTES_LEVEL) this.ports.send(listMessage(this.listEntries()), player);
  }

  /** A player's message: a request for a hash this share holds now (answered); false for any other, which the other shares read. */
  receive(from: string, body: unknown): boolean {
    const message = this.requestOf(from, body);
    if (message === null || !this.hashes.has(message.hash)) return false;
    this.answers.answer(from, message);
    return true;
  }

  /** The last to read a request: one for a hash this share held and no other share claimed is refused. */
  refuseGone(from: string, body: unknown): boolean {
    const message = this.requestOf(from, body);
    if (message === null || !this.hashes.wasHeld(message.hash)) return false;
    this.ports.send({ t: 'asset-refused', hash: message.hash }, from);
    return true;
  }

  private requestOf(from: string, body: unknown): Extract<PlayerMessage, { t: 'asset-request' }> | null {
    if (!isRecord(body) || body.t !== 'asset-request' || this.ports.levelOf(from) < NOTES_LEVEL) return null;
    const message = parsePlayerMessage(body);
    return message?.t === 'asset-request' ? message : null;
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
    moveKeys([this.entries, this.building, this.turns], oldPath, file.path);
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
    let changed = retitleHeld(this.entries, this.set);
    for (const path of [...this.entries.keys(), ...this.building.keys()]) {
      if (listed.has(path)) continue;
      changed ||= this.entries.delete(path);
      this.building.delete(path);
      this.turns.set(path, (this.turns.get(path) ?? 0) + 1);
    }
    this.failed.retain(listed);
    const held = this.set.heldPairs();
    const reads: Array<readonly [string, LinkState]> = [];
    for (const path of shared) {
      const state = linkState(this.ports.app.metadataCache.resolvedLinks[path] ?? {}, (target) => this.set.info(target));
      const entry = this.entries.get(path);
      const reading = this.building.get(path);
      // A title the copy may show that is gone or changed withdraws it now, whatever a failed read left; a link that only appeared leaves it listed until it is read again.
      const withdrawn = entry !== undefined && ([...entry.shown].some((pair) => !state.shown.has(pair)) || [...entry.linked].some((pair) => !held.has(pair)));
      if (withdrawn) changed = this.entries.delete(path) || changed;
      if (dirty.has(path)) this.failed.clear(path);
      else if (this.failed.skip(path, this.stamp(path, state.key))) continue;
      if (dirty.has(path) || (reading !== undefined ? reading !== state.key : withdrawn || entry?.linkKey !== state.key)) reads.push([path, state]);
    }
    if (changed) this.settle();
    for (const [path, state] of reads) void this.build(path, state);
    if (changed) this.publish();
  }

  private stamp(path: string, key: string): string {
    const stat = this.ports.app.vault.getFileByPath(path)?.stat;
    return `${stat?.mtime}\n${stat?.size}\n${key}`;
  }

  /** A note that cannot be copied is not shared until a later read succeeds: what it had is withdrawn at once. A transient failure is read again later. */
  private fail(path: string, turn: number, epoch: number, key: string, transient: boolean): void {
    if (this.turns.get(path) !== turn || this.epoch !== epoch) return;
    this.failed.mark(path, this.stamp(path, key), transient);
    if (!this.entries.delete(path)) return;
    this.settle();
    this.publish();
  }

  private async build(path: string, state: LinkState): Promise<void> {
    const epoch = this.epoch;
    const turn = (this.turns.get(path) ?? 0) + 1;
    this.turns.set(path, turn);
    this.building.set(path, state.key);
    this.pending++;
    try {
      const file = this.ports.app.vault.getFileByPath(path);
      const info = this.set.info(path);
      if (file === null || info === undefined) return;
      const source = await this.ports.app.vault.read(file);
      const linked = new Set<string>();
      const copy = await copyNote(source, path, this.ports.images, (linkpath) => {
        const target = this.noteTarget(linkpath, path);
        if (target !== null) linked.add(`${target.id}:${target.title}`);
        return target;
      });
      const bytes = new TextEncoder().encode(copy.markdown).slice();
      if (bytes.length > (this.ports.maxBytes ?? MAX_ASSET_BYTES)) return this.fail(path, turn, epoch, state.key, false);
      const ref = { hash: await sha256Hex(bytes), size: bytes.length, mime: TEXT_MIME_TYPE };
      if (this.turns.get(path) !== turn || this.epoch !== epoch || this.set.info(path)?.id !== info.id) return;
      if (![...linked].every((pair) => this.set.heldPairs().has(pair))) return this.fail(path, turn, epoch, state.key, true);
      this.entries.set(path, { id: info.id, title: info.title, group: info.group, ref, bytes, images: copy.images, linkKey: state.key, shown: state.shown, linked, embeds: source.includes('![') });
      this.failed.clear(path);
      this.settle();
    } catch {
      // Nothing is logged: it would name the note.
      this.fail(path, turn, epoch, state.key, true);
    } finally {
      if (this.turns.get(path) === turn) this.building.delete(path);
      if (this.epoch === epoch && --this.pending === 0) this.publish();
    }
  }

  private noteTarget(linkpath: string, from: string): { id: string; title: string } | null {
    const file = this.ports.app.metadataCache.getFirstLinkpathDest(linkpath, from);
    const info = file === null ? undefined : this.set.info(file.path);
    return info === undefined ? null : { id: info.id, title: info.title };
  }

  private listEntries(): Listed {
    return this.set.paths().flatMap((path) => {
      const entry = this.entries.get(path);
      return entry === undefined ? [] : [{ path, entry }];
    });
  }

  /** Sends the list to the players who can read it when it differs from the one sent last. */
  private publish(): void {
    const message = listMessage(this.listEntries());
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
    for (const hash of left) this.ports.dropTagged(notesTag(hash));
    if (left.length > 0) this.answers.forget();
    this.ports.images.retain(new Set(this.listEntries().flatMap(({ entry }) => [...entry.images.values()])));
  }
}
