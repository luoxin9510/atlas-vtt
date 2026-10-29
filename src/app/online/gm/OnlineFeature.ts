import { runInBackground } from '../../utils/backgroundTask';
import { Component, type App, type Plugin, type TFile } from 'obsidian';
import { showNotice } from '../../ui/notice';
import type { AtlasSettingSection } from '../../settings/settingSections';
import { AccountControl } from './account/AccountControl.ts';
import { obsidianHttp } from './account/obsidianHttp.ts';
import { secretHostKeyStore, secretTokenStore } from './account/tokenStore.ts';
import { BookShelf } from './book/BookShelf.ts';
import { BoundBookSource } from './book/campaignBookSource.ts';
import { readBooks } from './book/bookStore.ts';
import { CompanionDiagnostics } from './companionDiagnostics.ts';
import { companionTimers, every, stopCompanionTimers } from './companionTimers.ts';
import { DockMounts } from './dock/DockMounts.ts';
import { ImageTakeover } from './image/imageTakeover.ts';
import { atlasImageDisplay, localPlayerWindowOpen, readShownFile } from './image/atlasImageHost.ts';
import { LogMounts } from './log/LogMounts.ts';
import { TableChat } from './tableChat.ts';
import { lootCardOf } from './log/lootCard.ts';
import { PlayerLootDisplay } from '../../services/PlayerLootDisplay';
import { onlineApi } from './dock/panelModel.ts';
import type { OnlineCommandId } from './onlineCommands.ts';
import { OnlineControl } from './OnlineControl.ts';
import type { OnlineDataFile } from './onlineData.ts';
import type { OnlineTable } from './OnlineTable.ts';
import { Ownership } from './ownership.ts';
import { registerFeatureCommands } from './featureCommands.ts';
import { LegacyData } from './featureLegacy.ts';
import { readLegacyAssignments } from './legacyAssignments.ts';
import { NO_ASSIGNMENTS } from '../../campaigns/players/tokenAssignments';
import { readSavedTable, type SavedTable } from './savedTable.ts';
import { playedSeats, playSavedTable } from './tableCampaigns.ts';
import { appCampaignChoices } from './campaignChoices.ts';
import { DASHBOARD_VIEW_TYPE } from '../../dashboard-view';
import { setServerOrigin } from './servers.ts';
import { applyServerSetting } from './serverSettings.ts';
import { DEFAULT_SETTINGS, onlineSettingsSections, readSettings, type OnlineSettings } from './settings.ts';
import { t } from '../../i18n';

/** How long a change of the table's log waits before the data file is written. */
const LOG_SAVE_MS = 10_000;
/** How often the tab the table's log stands on and Atlas's image display are looked for. */
const SYNC_MS = 1_000;

/**
 * Online play: shares the scene of an Atlas map tab with players in their browsers. A child of the
 * plugin, loaded while the GM has online play switched on. Nothing connects until the GM starts a table.
 */
export class OnlineFeature extends Component {
  settings: OnlineSettings = { ...DEFAULT_SETTINGS };
  /** The GM's side of online play, for panels and commands: table, players and player tokens. */
  online: OnlineControl;
  /** The GM's Atlas account, which tables are asked for with. */
  readonly account: AccountControl;
  private readonly app: App;
  /** The running table as saved in this device's data, so a reload comes back to it. */
  private savedTable: SavedTable | null = null;
  /** The running table's log as saved with it; undefined while there is none. */
  private savedLog: unknown = undefined;
  private logSave: number | null = null;
  /** Where the shelf keeps books: the campaign's books file once a table is bound to one, else nowhere (they stay in memory). */
  private readonly bookSource = new BoundBookSource();
  /** The players' books; they outlive tables. */
  private readonly books = new BookShelf(this.bookSource);
  /** What an older Atlas kept in this device's data, until a campaign's files have taken it over. */
  private readonly legacy: LegacyData;
  private docks: DockMounts | null = null;
  private logs: LogMounts | null = null;
  /** The table's log for other plugins (`TableChat`). */
  readonly chat = new TableChat(() => (this.ready ? this.online.table : null));
  /** False before loading and after unloading: commands are offered and data is taken in only while true. */
  private live = false;
  /** True once this device's data was read: before that there is nothing to show in the settings, or to save. */
  private ready = false;
  private commands = new Map<OnlineCommandId, (checking: boolean) => boolean>();

  constructor(private readonly plugin: Plugin, private readonly data: OnlineDataFile, private readonly onSectionsChanged: () => void = () => undefined) {
    super();
    this.app = plugin.app;
    this.legacy = new LegacyData({ app: this.app, bookSource: this.bookSource, books: this.books, save: () => this.saveSettings() });
    const campaigns = this.legacy.campaigns();
    this.online = new OnlineControl(this.app, new Ownership(playedSeats(campaigns)), campaigns);
    this.account = new AccountControl({
      http: obsidianHttp,
      timers: companionTimers(),
      tokens: secretTokenStore(this.app),
      hostKeys: secretHostKeyStore(this.app),
      openUrl: (url) => void window.open(url),
      notify: (text) => showNotice(text),
    });
  }

  /** The running table, or null. */
  get table(): OnlineTable | null {
    return this.online.table;
  }

  /** Online play's sections of Atlas's settings; none until its data was read, so no row can save over it. */
  settingsSections(): AtlasSettingSection[] {
    return this.ready ? onlineSettingsSections(this) : [];
  }

  /** Runs one of online play's commands, or checks whether it can run now. */
  runCommand(id: OnlineCommandId, checking: boolean): boolean {
    return this.live && (this.commands.get(id)?.(checking) ?? false);
  }

  onload(): void {
    this.live = true;
    void this.start().catch((error: unknown) => console.error('[Atlas] Online play could not start:', error));
  }

  private async start(): Promise<void> {
    const version = this.plugin.manifest.version;
    // Online play's own uncaught errors go to the console, and to the table's server once the GM switched error reports on.
    const diagnostics = new CompanionDiagnostics({
      reportErrors: () => this.settings.reportErrors,
      setReportErrors: (on) => {
        this.settings.reportErrors = on;
        void this.saveSettings();
      },
      table: () => this.savedTable,
      playerNames: () => this.online.players().map((player) => player.name),
      connection: () => this.online.table?.connectionStats() ?? null,
    }, version, () => version);
    this.register(diagnostics.listen(window));
    const data = await this.data.read();
    // Switched off while the data was read: nothing more is set up.
    if (!this.live) return;
    this.settings = readSettings(data);
    applyServerSetting(this.settings);
    // The module-wide server address goes with this feature.
    this.register(() => setServerOrigin(null));
    this.ready = true;
    // Obsidian 1.13+ reads the settings' sections once: tell it these exist now.
    this.onSectionsChanged();
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const campaigns = this.legacy.campaigns();
    const ownership = new Ownership(playedSeats(campaigns));
    this.legacy.assignments = readLegacyAssignments(record.ownership);
    this.savedTable = readSavedTable(record.table);
    this.savedLog = this.savedTable === null ? undefined : record.tableLog;
    this.legacy.books = readBooks(record.books);
    // A campaign is played only while its table runs: the saved table's comes back with it.
    playSavedTable(campaigns, this.savedTable);
    // Player tokens are marked on the played campaign, so it takes over the old ones now.
    const played = campaigns.playing();
    if (played !== null) void this.legacy.migrateAssignmentsInto(played).catch((error: unknown) => console.error('[Atlas] Carrying the player tokens into the campaign failed:', error));
    this.online = new OnlineControl(this.app, ownership, campaigns, (table) => {
      this.savedTable = table;
      void this.saveSettings();
    }, this.account, { read: () => this.savedLog, write: (entries) => this.keepLog(entries) }, this.books);
    // Atlas's "Display on player view" reaches the players online too, while a table runs.
    const images = new ImageTakeover<TFile>(() => atlasImageDisplay(this.app), {
      share: () => this.online.table?.image ?? null,
      readFile: (file) => readShownFile(this.app, file),
      pathOf: (file) => file.path,
      localWindowOpen: () => localPlayerWindowOpen(this.app),
      notice: (text) => showNotice(text),
    });
    this.register(() => images.dispose());
    // Loot handed out from the roller goes into the table's log while a table runs.
    const loot = PlayerLootDisplay.get();
    loot.setOutlet((draw) => {
      const item = this.online.table === null ? null : lootCardOf(draw);
      if (item === null) return false;
      this.online.table?.log.lootHanded(item);
      return true;
    });
    this.register(() => loot.setOutlet(null));
    const docks = new DockMounts(this.app.workspace, {
      api: onlineApi(this.online, () => images.hide()),
      account: this.account,
      campaigns: appCampaignChoices(this.app),
      openCampaigns: () => void this.app.workspace.getLeaf(true).setViewState({ type: DASHBOARD_VIEW_TYPE, active: true }),
      imageSrc: (path) => this.app.vault.adapter.getResourcePath(path),
      feedback: diagnostics,
      opened: (leaf) => logs.close(leaf),
    });
    this.docks = docks;
    // The table's log, where Atlas's dice log opens on the tab players see.
    const logs = new LogMounts({
      table: () => this.online.table,
      imageSrc: (path) => this.app.vault.adapter.getResourcePath(path),
      opened: (leaf) => docks.dockOf(leaf)?.makeWay(),
      openNote: (link, sourcePath) => runInBackground(this.app.workspace.openLinkText(link, sourcePath, true), `Opening ${link}`, t('onlineGm.found.openFailed')),
    });
    this.logs = logs;
    this.register(this.online.onChange(() => (logs.sync(), logs.refresh(), images.sync(), this.chat.sync())));
    this.register(() => this.chat.dispose());
    this.register(this.online.logs.onChange(() => logs.logChanged()));
    // Which tab players see changes without a word (Atlas presents another, the tab closes), and so does Atlas's image display: looked at as often as the table looks.
    this.register(every(companionTimers(), SYNC_MS, () => (logs.sync(), images.sync())));
    this.app.workspace.onLayoutReady(() => {
      if (!this.live) return;
      // A table that ran when Obsidian or Atlas was last unloaded comes back with the same link.
      if (this.savedTable !== null) void this.online.resume(this.savedTable);
      // A signed-in GM's session is renewed, and the dock learns what it may host.
      void this.account.refresh(true);
      docks.sync();
      logs.sync();
    });
    this.commands = registerFeatureCommands({ app: this.app, online: () => this.online, docks, table: () => this.table });
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.table?.checkLeaf();
      docks.sync();
      logs.sync();
    }));
  }

  onunload(): void {
    this.live = false;
    this.docks?.dispose();
    this.docks = null;
    this.logs?.dispose();
    this.logs = null;
    // A change of the log that still waits to be saved is saved now, and so are the books still waiting for the campaign's file.
    if (this.logSave !== null) void this.saveSettings();
    this.bookSource.flush();
    // Unloading closes the connection only: the table stays on the server and comes back on the next load.
    this.online.close();
    stopCompanionTimers();
  }

  /** Saves the settings with the running table, its log, and the books, token owners and player tokens not carried over yet. */
  async saveSettings(): Promise<void> {
    if (this.logSave !== null) companionTimers().clearTimer(this.logSave);
    this.logSave = null;
    await this.data.write({
      ...this.settings,
      table: this.savedTable,
      ...(this.savedLog !== undefined && { tableLog: this.savedLog }),
      ...(Object.keys(this.legacy.books).length > 0 && { books: this.legacy.books }),
      ...(this.legacy.assignments !== NO_ASSIGNMENTS && { ownership: this.legacy.assignments }),
    });
  }

  /** From now on the players' books are kept in this campaign's file, or in memory only for null. */
  bindBooks(campaignId: string | null): void {
    this.legacy.bindBooks(campaignId);
  }

  /** Carries the books an older Atlas kept in this device's data into the campaign's books file, once. */
  migrateBooksInto(campaignId: string): Promise<void> {
    return this.legacy.migrateBooksInto(campaignId);
  }

  /** Carries the token owners and player tokens an older Atlas kept in this device's data into the campaign's players file, once. */
  migrateAssignmentsInto(campaignId: string): Promise<void> {
    return this.legacy.migrateAssignmentsInto(campaignId);
  }

  /** Keeps the table's log: a cleared one at once, a changed one within `LOG_SAVE_MS` (every message would write the data file). */
  private keepLog(log: object | null): void {
    const cleared = log === null;
    if (cleared && this.savedLog === undefined) return;
    this.savedLog = cleared ? undefined : log;
    if (cleared) return void this.saveSettings();
    this.saveSoon();
  }

  /** Writes the data file within `LOG_SAVE_MS`: every message or note would write it otherwise. */
  private saveSoon(): void {
    this.logSave ??= companionTimers().setTimer(() => void this.saveSettings(), LOG_SAVE_MS);
  }
}
