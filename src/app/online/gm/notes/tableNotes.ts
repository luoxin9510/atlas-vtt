import type { App } from 'obsidian';
import { QuestImages } from '../../../plugin/questImages';
import type { GmMessage } from '../../protocol/index.ts';
import type { ScaleImage } from '../assetVariants.ts';
import type { AssetAnswerPorts } from '../assetAnswers.ts';
import type { VaultImage } from '../TokenShare.ts';
import { NotesShare } from './NotesShare.ts';

/** What the table gives its notes: the vault, who is at the table, and the wire. */
export interface TableNotesDeps {
  readonly app: App;
  players(): readonly string[];
  forkLevelOf(player: string): number;
  send(body: GmMessage, to: string, tag?: string): void;
  dropTagged(tag: string): void;
  randomId(): string;
  now(): number;
  tickets?: AssetAnswerPorts['tickets'];
  readImage(path: string): Promise<VaultImage | null>;
  scaleImage?: ScaleImage;
  /** The share's count or cap changed. */
  changed?(): void;
}

/** The table's shared notes, built on its connection, seats and fork levels. */
export function tableNotes(deps: TableNotesDeps): NotesShare {
  return new NotesShare({
    app: deps.app,
    players: () => deps.players(),
    levelOf: (player) => deps.forkLevelOf(player),
    send: (body, to, tag) => deps.send(body, to, tag),
    dropTagged: (tag) => deps.dropTagged(tag),
    randomId: () => deps.randomId(),
    now: () => deps.now(),
    tickets: deps.tickets,
    images: new QuestImages(deps.app),
    readImage: (path) => deps.readImage(path),
    scaleImage: deps.scaleImage,
    changed: () => deps.changed?.(),
  });
}
