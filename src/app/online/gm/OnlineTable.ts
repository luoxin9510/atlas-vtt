import type { ConnectionStats } from '../protocol/index.ts';
import type { App, WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import type { ArmedCards } from './armedCards.ts';
import { AssetTickets } from './assetUpload/AssetTickets.ts';
import type { ImageCacheReason } from './assetUpload/uploadAsset.ts';
import { obsidianBinaryHttp } from './assetUpload/binaryHttp.ts';
import type { SceneStore } from './atlasView.ts';
import type { BookRests } from './book/bookRests.ts';
import type { TableBook } from './book/tableBook.ts';
import { companionTimers, every } from './companionTimers.ts';
import type { ImageShare } from './image/ImageShare.ts';
import type { TableGate } from './joinGate.ts';
import { gmRoll, type GmRollDraft, type GmRollRefusal } from './log/gmRolls.ts';
import type { TableLog } from './log/TableLog.ts';
import type { Ownership } from './ownership.ts';
import { presentedSceneSource } from './presentedScene.ts';
import { ForkClients } from './forkClients.ts';
import { PauseShare, tablePause, type TablePause } from './PauseShare.ts';
import type { SceneBinding } from './sceneBinding.ts';
import type { TabWatch } from './sharedTab.ts';
import type { CoveredPages } from './coveredPages.ts';
import { TableConnection, type TableStatus } from './TableConnection.ts';
import { TableRoster } from './tableRoster.ts';
import { closingText, tableEndOf, tableEndText, type TableEnd } from './tableEnd.ts';
import type { OnlineTableEvents } from './tableEvents.ts';
import { buildShares } from './tableShares.ts';
import { connectionHandlers, logRests, sceneWatch } from './tableWiring.ts';
import type { FoundShare } from './pins/FoundShare.ts';
import type { NotesShare } from './notes/NotesShare.ts';
import type { OnlineTableOptions } from './onlineTableOptions.ts';

/** How often the presented tab is looked for, and the shared one checked. */
const WATCH_MS = 1_000;

/**
 * One running table: the socket, the join link, and the scene Atlas presents to its player view (the eye
 * on a scene tab), followed through Atlas's lifecycle (`TabWatch`). Players never follow the GM's own tab
 * switches: while the GM works on another scene tab they keep what they saw. While the presented tab is
 * gone (Atlas reloads, the tab was closed) or Atlas presents nothing, players are sent no scene; once a
 * view shows the presented scene it is shared.
 */
export class OnlineTable {
  private readonly app: App;
  private readonly connection: TableConnection;
  private readonly watch: TabWatch<SceneBinding>;
  private stopWatchTimer: () => void = () => undefined;
  private stopFollowingPresented: () => void = () => undefined;
  private stopLoggingRests: () => void = () => undefined;
  private currentStatus: TableStatus = 'connecting';
  private closing: number | null = null;
  /** The closing time the GM was last told with a notice: a reconnect names the same one again. */
  private toldClosing: number | null = null;
  private readonly events: OnlineTableEvents;
  readonly ownership: Ownership;
  /** The arming clock of the cards over the control: newcomers who knock, and players who ask for a rest. */
  private readonly cards: ArmedCards;
  /** The table's gates: the join code, the two switches, and who waits for an answer. */
  readonly gate: TableGate;
  /** The game pause: while on, players' moves are refused; kept with the table. */
  readonly pause: TablePause;
  /** The players of the campaign the table runs on. */
  readonly roster: TableRoster;
  /** The table's log: chat, rolls, who came and went. */
  readonly log: TableLog;
  /** The image the GM shows every player over the map, while one is shown. */
  readonly image: ImageShare;
  /** The players' books: each one's own pages besides the table, kept on this device's shelf. */
  private readonly books: TableBook;
  /** The readable pins players find, and the notes they found. */
  private readonly found: FoundShare;
  /** The notes marked `atlas-share`, shared with players of fork level 3. */
  readonly notes: NotesShare;
  /** The pages whose book covers their map, which the table's activity leaves out. */
  private readonly covers: CoveredPages;
  /** The join link players open. */
  readonly link: string;
  private readonly stopOwnership: () => void;
  /** The fork level each player's app declared. */
  private readonly forkClients: ForkClients;
  private readonly pauseShare: PauseShare;
  /** Why the relay's image cache cannot be used now (images go over the socket); null while it can. */
  get imageCache(): ImageCacheReason | null {
    return this.tickets.status;
  }
  /** Download tickets of the images this table keeps on the server. */
  private readonly tickets: AssetTickets;

  constructor(options: OnlineTableOptions) {
    const { app, origin, table, mapPath, ownership, seats, gate, paused, events, shelf, savedLog } = options;
    this.app = app;
    this.tickets = new AssetTickets(obsidianBinaryHttp, { origin, code: table.code, secret: table.secret }, () => Date.now(), () => events.changed());
    this.forkClients = new ForkClients((player): void => { this.pauseShare.client(player); this.notes.client(player); });
    const pauseShare = new PauseShare({
      players: () => ownership.onlinePlayers(),
      levelOf: (player) => this.forkClients.levelOf(player),
      send: (body, to) => this.connection.send(body, to),
    }, paused);
    this.pauseShare = pauseShare;
    this.pause = tablePause(pauseShare, { cancelDrags: () => this.bound()?.share.cancelDrags(), paused: (on) => events.paused(on), changed: () => events.changed() });
    this.ownership = ownership;
    this.events = events;
    this.link = `${origin}/#${table.code}`;
    const shares = buildShares({
      app, ownership, seats, gate, shelf, savedLog, events, tickets: this.tickets, forkClients: this.forkClients,
      connection: () => this.connection,
      bound: () => this.bound(),
    });
    this.cards = shares.cards;
    this.gate = shares.gate;
    this.log = shares.log;
    this.image = shares.image;
    this.found = shares.found;
    this.notes = shares.notes;
    this.books = shares.books;
    this.covers = shares.covers;
    this.watch = sceneWatch({
      app, ownership, forkClients: this.forkClients, tickets: this.tickets, pauseShare, shares, events, mapPath,
      send: (body, to, tag) => this.connection.send(body, to, tag),
      withdraw: () => this.withdraw(),
    });
    this.connection = new TableConnection(origin, table.code, table.secret, connectionHandlers({
      ownership, forkClients: this.forkClients, shares,
      roster: () => this.roster,
      bound: () => this.bound(),
      resend: (to) => this.resend(to),
      setStatus: (status) => this.setStatus(status),
      setClosing: (closesAt) => this.setClosing(closesAt),
      sceneOrGone: (from, body) => this.sceneOrGone(from, body),
    }), this.gate);
    this.roster = new TableRoster(seats, this.connection, { kick: (player) => this.kick(player), turnAway: (player) => this.connection.kick(player), joinCode: () => this.gate.settings.code });
    this.stopOwnership = ownership.onChange(() => this.bound()?.share.ownersChanged());
  }

  /** The players' rest requests waiting for the GM, and the GM's answers to them. */
  get rests(): BookRests {
    return this.books.share.rests;
  }

  /** The keys of the cards over the control, newcomers' and rest requests', in the order they came. */
  cardOrder(): readonly string[] {
    return this.cards.keys();
  }

  /** The Atlas tab players see live: bound, and showing the presented scene now; null while there is none. */
  get sharedTab(): WorkspaceLeaf | null {
    const binding = this.watch.binding;
    return binding?.showing === true ? this.watch.current?.leaf ?? null : null;
  }

  /** The shared scene's store as players see it (frozen while the GM works on another tab), or null while none is shared. */
  get sharedStore(): SceneStore | null {
    return this.watch.binding?.store ?? null;
  }

  /** The name of the scene tab Atlas presents, or null while it presents none of the open tabs. */
  get presentedName(): string | null {
    return this.watch.presented?.name ?? null;
  }

  get status(): TableStatus {
    return this.currentStatus;
  }

  /** When the relay closes the table because its account may no longer host (the relay's clock), or null. */
  get closesAt(): number | null {
    return this.closing;
  }

  /** The least GM level the relay's player page needs, as its last welcome said; null while it said none. */
  get minLevel(): number | null {
    return this.connection.minLevel;
  }

  /** How the table's connection went, for feedback's diagnostics. */
  connectionStats(): ConnectionStats {
    return this.connection.stats();
  }

  /** A GM's roll from the log (its composer, a roll button, another plugin), on the shared scene's dice. */
  rollFromLog(draft: GmRollDraft): Promise<GmRollRefusal | null> {
    const binding = this.bound();
    return gmRoll(draft, this.log, binding?.share.dice ?? null, binding?.store ?? null);
  }

  /** Removes a player: their key stops working, their browser leaves the table and their tokens are nobody's. */
  kick(player: string): void {
    this.roster.kicked(player);
    this.connection.kick(player);
    this.ownership.remove(player);
  }

  start(): void {
    this.roster.start();
    this.connection.start();
    this.books.start();
    this.found.start();
    this.notes.start();
    // Every rest that reaches a character of this table the GM's Atlas takes while it runs is logged: approved requests and the GM's own.
    this.stopLoggingRests = logRests(this.log, this.ownership, this.books.share);
    this.watch.check();
    this.stopWatchTimer = every(companionTimers(), WATCH_MS, () => this.watch.check());
    // Atlas presenting another scene is followed at once; the timer catches everything else
    this.stopFollowingPresented = presentedSceneSource(this.app)?.onChange(() => this.watch.check()) ?? ((): void => undefined);
  }

  /** Looks at the presented and the shared tab again (the workspace's layout changed). */
  checkLeaf(): void {
    this.watch.check();
  }

  /** Ends the table on the server and stops sharing. */
  end(): void {
    this.stopWatch();
    this.connection.end();
  }

  /** Closes the socket and stops sharing, leaving the table on the server: a reload comes back to it. */
  close(): void {
    this.stopWatch();
    this.connection.stop();
  }

  private setStatus(status: TableStatus): void {
    this.currentStatus = status;
    if (status === 'stopped') this.finish('stopped');
    else if (status === 'refused') {
      const end = tableEndOf(this.connection.closeCode);
      showNotice(tableEndText(end));
      this.finish(end);
    }
    this.events.status(status);
  }

  private finish(end: 'stopped' | TableEnd): void {
    this.stopWatch();
    this.stopOwnership();
    this.roster.dispose();
    this.gate.dispose();
    this.log.dispose();
    this.books.stop();
    this.cards.dispose();
    this.tickets.forget();
    this.covers.reset();
    this.closing = null;
    this.events.ended(end);
  }

  /** The relay named when the table closes for want of access, or took it back; the GM is told once per time, also while the control is closed. */
  private setClosing(closesAt: number | null): void {
    if (closesAt === this.closing) return;
    this.closing = closesAt;
    if (closesAt !== null && closesAt !== this.toldClosing) {
      this.toldClosing = closesAt;
      showNotice(closingText(closesAt));
    }
    this.events.changed();
  }

  private stopWatch(): void {
    this.stopLoggingRests();
    this.found.stop();
    this.notes.stop();
    this.stopWatchTimer();
    this.stopFollowingPresented();
    this.watch.stop();
  }

  /** The scene share reads what is left (it refuses an asset it does not show); with none bound, a request for a hash the notes once held is refused. */
  private sceneOrGone(from: string, body: unknown): boolean {
    const bound = this.bound();
    if (bound === null) return this.notes.refuseGone(from, body);
    bound.share.receive(from, body);
    return true;
  }

  /** The binding of the tab shared now, while it is still the same tab; null while there is none. */
  private bound(): SceneBinding | null {
    const binding = this.watch.binding;
    return binding !== null && this.watch.isLive(binding) ? binding : null;
  }

  /** The scene, tokens and the rest to one player or to all, or no scene while the shared tab is gone; then the log, the shown image and the books. */
  private resend(to?: string): void {
    const binding = this.bound();
    if (binding === null) this.connection.send({ t: 'scene', scene: null }, to);
    else binding.share.resend(to);
    this.log.resend(to);
    this.image.resend(to);
    this.notes.resend(to);
    this.books.share.resend(to);
  }

  /** Players see no scene while the shared tab is gone, so nothing of what they saw lingers or moves. */
  private withdraw(): void {
    this.connection.send({ t: 'scene', scene: null });
  }
}
