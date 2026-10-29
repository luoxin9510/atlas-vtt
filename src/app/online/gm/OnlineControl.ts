import { type App, type WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { activeAtlasLeaf } from './atlasView.ts';
import type { CampaignPlayer } from '../../campaigns/players/playersFile';
import { BookShelf } from './book/BookShelf.ts';
import { renewTable, resumeTable, startTable, type ControlHost } from './controlStart.ts';
import { giveSharedTokens, markPlayerTokens, markSelected, selectedTokens, sharedScene, type TokenPorts } from './controlTokens.ts';
import { GM_LEVEL } from '../protocol/index.ts';
import { isOutdated } from './gmLevel.ts';
import { LogKeeper, type LogStore } from './log/logStore.ts';
import { OnlineTable } from './OnlineTable.ts';
import type { KnownPlayer, Ownership } from './ownership.ts';
import { playerTokenRows, type PlayerTokenRow } from './playerTokenRows.ts';
import { presentOnPlayerView, presentedSceneSource, showPresentedElsewhere, type ShownElsewhere } from './presentedScene.ts';
import type { SavedTable } from './savedTable.ts';
import type { TableCampaigns } from './tableCampaigns.ts';
import { NO_ACCOUNT, type HostAccount } from './tableStart.ts';
import type { TableStatus } from './TableConnection.ts';
import type { LostTable } from './tableEnd.ts';
import { t } from '../../i18n';

/**
 * The GM's side of online play, free of any panel: start and stop a table of a campaign, which this
 * device plays exactly while the table runs or comes back after a reload, its link and status, the
 * campaign's players (list, add, rename, new code, kick, remove), and the scene's player tokens
 * (list with owners, mark and unmark, give to a player, take back). Panels and commands call this
 * and redraw on `onChange`.
 */
export class OnlineControl {
  private readonly app: App;
  readonly ownership: Ownership;
  /** Keeps the running table in the companion's data (null: none runs), so a reload comes back to it. */
  private readonly save: (table: SavedTable | null) => void;
  private current: OnlineTable | null = null;
  private saved: SavedTable | null = null;
  private starting = false;
  /** Counts the times the control was closed, so a start or resume that waited across one runs no table. */
  private closings = 0;
  private ended: LostTable | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly account: HostAccount;
  /** Atlas told that players see its presented scene online, while a table runs. */
  private shown: ShownElsewhere | null = null;
  /** Stops following what is played, which only matters while a table runs. */
  private unwatch = (): void => undefined;
  /** The running table's log, kept with it and told to its panels. */
  readonly logs: LogKeeper;
  private readonly tokenPorts: TokenPorts;
  private readonly host: ControlHost;

  constructor(app: App, ownership: Ownership, private readonly campaigns: TableCampaigns, save: (table: SavedTable | null) => void = () => undefined, account: HostAccount = NO_ACCOUNT, logStore?: LogStore, shelf = new BookShelf()) {
    this.app = app;
    this.ownership = ownership;
    this.save = save;
    this.logs = new LogKeeper(logStore);
    this.account = account;
    this.tokenPorts = { ownership, campaigns, app, current: () => this.current };
    this.host = {
      app, campaigns, account, ownership, logs: this.logs, shelf,
      // Read anew at each call: a close during an `await` must be seen.
      closings: () => this.closings,
      current: () => this.current,
      saved: () => this.saved,
      isStarting: () => this.starting,
      setStarting: (on) => {
        this.starting = on;
        this.changed();
      },
      setCurrent: (table) => {
        this.current = table;
      },
      setUnwatch: (unwatch) => {
        this.unwatch = unwatch;
      },
      stop: () => this.stop(),
      end: () => this.end(),
      keep: (saved) => this.keep(saved),
      changed: () => this.changed(),
      detach: () => {
        this.current = null;
        this.unbind();
        this.syncShown();
      },
      setEnded: (end) => {
        this.ended = end;
      },
    };
    ownership.onChange(() => this.changed());
  }

  /** Calls the listener after every change of the table, its players or the player tokens; returns the way to stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The running table, or null. */
  get table(): OnlineTable | null {
    return this.current;
  }

  /** The table's status, or null while none runs. */
  status(): TableStatus | null {
    return this.current?.status ?? null;
  }

  /** The join link of the running table, or null. */
  link(): string | null {
    return this.current?.link ?? null;
  }

  /** The id of the campaign the running table plays; null while none runs. */
  campaignId(): string | null {
    return this.current === null ? null : this.saved?.campaignId ?? null;
  }

  /** The players the running table seats, or null while none runs. */
  seats(): number | null {
    return this.current === null ? null : this.saved?.maxPlayers ?? null;
  }

  /** Whether a table is being created on the server. */
  isStarting(): boolean {
    return this.starting;
  }

  /** How the last table ended, if the server ended it and not the GM; null otherwise. Cleared by the next start. */
  lost(): LostTable | null {
    return this.ended;
  }

  /** Whether the relay asked for a newer Atlas than this one, the last time it said. */
  outdated(): boolean {
    return isOutdated(this.app);
  }

  /** Whether the running table's relay needs a newer Atlas than this one: it let it in because players sit at the table. */
  updateAfterSession(): boolean {
    return (this.current?.minLevel ?? 0) > GM_LEVEL;
  }

  /** Whether a table can be started now: none runs or is starting, and an Atlas tab is active. */
  canStart(): boolean {
    return this.current === null && !this.starting && activeAtlasLeaf(this.app) !== null;
  }

  /**
   * Starts a table of the campaign `campaignId` from the Atlas tab `leaf`, on the campaign's lasting
   * link; tells the GM with a notice why it cannot. Once it runs, this device plays that campaign
   * until the table ends. Players see the scene Atlas presents to its player view.
   */
  start(leaf: WorkspaceLeaf | null, campaignId: string | null): Promise<OnlineTable | null> {
    return startTable(this.host, leaf, campaignId);
  }

  /**
   * Comes back to a table saved before a reload: same link and host secret, the campaign it was
   * started for and that campaign's players, once its players file was read; players see the scene
   * Atlas presents again. The campaign stays played while it comes back, and is played no longer
   * where its players cannot be read.
   */
  resume(saved: SavedTable): Promise<OnlineTable | null> {
    return resumeTable(this.host, saved);
  }

  /** Ends the running table for good: the link stops working, the saved table is forgotten and its campaign is played no longer. */
  stop(): void {
    this.end();
    this.campaigns.stop();
  }

  /** Closes the running table's connection for a reload, keeping it on the server and in the saved data. */
  close(): void {
    this.closings += 1;
    const table = this.current;
    this.current = null;
    table?.close();
    this.unbind();
    this.syncShown();
  }

  /** Shows the active scene of this Atlas tab on Atlas's player view, which players online see too. */
  share(leaf: WorkspaceLeaf): void {
    if (!presentOnPlayerView(this.app, leaf)) showNotice(t('onlineGm.share.noPlayerView'));
  }

  /** Every player of the running table's campaign: those online first, then by name. */
  players(): KnownPlayer[] {
    return this.ownership.list();
  }

  /** Takes a player off the running table: their key for it stops working; they come back with their own code. */
  kick(playerId: string): void {
    this.current?.kick(playerId);
  }

  /** A player's own code in the running table's campaign, else in the played one; null for anyone it does not know. */
  playerCode(playerId: string): string | null {
    const playing = this.campaigns.playing();
    const seats = this.current?.roster.seats ?? (playing === null ? null : this.campaigns.known(playing));
    return seats?.codeOf(playerId) ?? null;
  }

  /** Gives a player a new code: the old one stops working at once, and a connected player stays. */
  newPlayerCode(playerId: string): void {
    this.current?.roster.newCode(playerId);
  }

  /** Adds a player the GM names to the running table's campaign; null where it cannot (the GM is told why). */
  addPlayer(name: string): CampaignPlayer | null {
    return this.current?.roster.add(name) ?? null;
  }

  renamePlayer(playerId: string, name: string): void {
    this.current?.roster.rename(playerId, name);
  }

  /** Removes a player from the campaign: their code stops working and they leave the table; their characters are nobody's. */
  removeFromCampaign(playerId: string): void {
    this.current?.roster.remove(playerId);
  }

  /**
   * Gives the campaign a new link, so the old one stops working; a running table starts again on it.
   * Where it could not start again (no Atlas tab, signed out) nothing changes and the GM is told why.
   */
  newLink(): Promise<void> {
    return renewTable(this.host);
  }

  /** The player tokens of the shared scene as players see it (of the active Atlas tab while none is shared), with who has each. */
  playerTokens(): PlayerTokenRow[] {
    return playerTokenRows(this.ownership, sharedScene(this.tokenPorts));
  }

  /** The tokens selected on the active Atlas tab (the shared one when none is active). */
  selectedTokens(): string[] {
    return selectedTokens(this.tokenPorts);
  }

  /** Makes tokens of the shared scene player tokens, or the GM's own (which takes them back from their players). */
  markPlayerTokens(tokenIds: readonly string[], player: boolean): void {
    markPlayerTokens(this.tokenPorts, tokenIds, player);
  }

  /** Makes the tokens selected on the active Atlas tab player tokens, or the GM's own; the number of tokens changed, null where no campaign keeps them. */
  markSelected(player: boolean): number | null {
    return markSelected(this.tokenPorts, player);
  }

  /** Gives tokens to a player, or takes them back from whoever has them (null). A token nobody had sees from then on (`seeAsPlayers`). */
  give(tokenIds: readonly string[], playerId: string | null): void {
    giveSharedTokens(this.tokenPorts, tokenIds, playerId);
  }

  /** Ends the running table on the server and forgets the saved one; what is played stays as it is. */
  private end(): void {
    this.current?.end();
    this.keep(null);
  }

  /** No table runs: nobody plays, and the books stay in memory. */
  private unbind(): void {
    this.unwatch();
    this.unwatch = (): void => undefined;
    this.ownership.bind(null);
    this.campaigns.bound(null);
  }

  private keep(saved: SavedTable | null): void {
    if (saved === null && this.saved === null) return;
    this.saved = saved;
    this.save(saved);
    // The log goes with its table.
    if (saved === null) this.logs.forget();
  }

  private changed(): void {
    this.syncShown();
    for (const listener of this.listeners) listener();
    this.logs.changed();
  }

  /**
   * Keeps Atlas told that players see its presented scene online for as long as a table runs, so
   * the eye on a scene tab moves the table instead of opening the local player window. A reloaded
   * Atlas has a presented scene of its own, which is told again at the next change.
   */
  private syncShown(): void {
    const source = this.current === null ? null : presentedSceneSource(this.app);
    if (this.shown !== null && this.shown.source !== source) {
      this.shown.stop();
      this.shown = null;
    }
    if (this.current !== null && this.shown === null) this.shown = showPresentedElsewhere(this.app);
  }
}
