import type { App, WorkspaceLeaf } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { activeAtlasLeaf, sceneStoreOf } from './atlasView.ts';
import { CAMPAIGNS_LOADING_TEXT, linkRefusal, NO_CAMPAIGN_TEXT, renewLink, type TableSeats } from './campaignSeats.ts';
import type { BookShelf } from './book/BookShelf.ts';
import { tableEvents, type EventsHost } from './controlEvents.ts';
import type { CreatedTable } from './createdTable.ts';
import { rememberMinLevel } from './gmLevel.ts';
import { freeGate, newGate } from './joinGate.ts';
import { OnlineTable } from './OnlineTable.ts';
import type { Ownership } from './ownership.ts';
import type { SavedTable } from './savedTable.ts';
import { relayOrigin } from './servers.ts';
import { endStrayTable } from './strayTable.ts';
import type { TableCampaigns } from './tableCampaigns.ts';
import { createCampaignTable, refused, startBlock, type HostAccount } from './tableStart.ts';

/** What the start reads: Atlas, the campaigns, the account, and how many times the control was closed so far (read anew at each call, never kept). */
export interface StartPorts {
  readonly app: App;
  readonly campaigns: TableCampaigns;
  readonly account: HostAccount;
  closings(): number;
  /** Tells the panels something changed. */
  changed(): void;
}

/** A table the server made and that is still wanted, with what it needs to run. */
export interface StartedTable {
  readonly created: CreatedTable;
  readonly seats: TableSeats;
  /** The server it was made on. */
  readonly origin: string;
  readonly mapPath: string | null;
}

/**
 * Asks the server for a table of the campaign from the Atlas tab `leaf`, telling the GM with a notice
 * why it cannot. A table made while the control was closed or the server address was edited is ended
 * on the server it was made on, and none is returned. `markStarting` tells when the asking begins and ends.
 */
export async function prepareStart(ports: StartPorts, leaf: WorkspaceLeaf | null, campaignId: string | null, markStarting: (on: boolean) => void): Promise<StartedTable | null> {
  const blocked = startBlock(leaf, campaignId, ports.account);
  const token = ports.account.token();
  // The server is read once: the table is asked of it, and run on it or ended there, whatever the setting says by then.
  const origin = relayOrigin();
  if (blocked !== null || leaf === null || campaignId === null || token === null || origin === null) return refused(blocked ?? NO_CAMPAIGN_TEXT);
  markStarting(true);
  ports.changed();
  const closings = ports.closings();
  const made = await createCampaignTable(ports.campaigns, campaignId, token, origin, ports.account, (level) => rememberMinLevel(ports.app, level)).finally(() => markStarting(false));
  ports.changed();
  if (made === null) return null;
  // The control was closed while the table was made: nothing keeps this table, so it is ended on the server it was made on.
  if (closings !== ports.closings()) {
    endStrayTable(origin, made.created);
    return null;
  }
  // The address was edited while the table was made: it belongs to a server that is no longer the one set.
  if (relayOrigin() !== origin) {
    endStrayTable(origin, made.created);
    return null;
  }
  return { created: made.created, seats: made.seats, origin, mapPath: sceneStoreOf(leaf)?.getState().mapPath ?? null };
}

/** What the control lends to starting, resuming, running and renewing a table. */
export interface ControlHost extends EventsHost {
  readonly ownership: Ownership;
  readonly shelf: BookShelf;
  closings(): number;
  isStarting(): boolean;
  /** Sets the flag that a table is being made; tells nobody. */
  setStarting(on: boolean): void;
  setCurrent(table: OnlineTable): void;
  setUnwatch(unwatch: () => void): void;
  /** Ends the running table for good, as `OnlineControl.stop` does. */
  stop(): void;
  /** Ends the running table on the server and forgets the saved one. */
  end(): void;
}

/** Starts a table of the campaign from the Atlas tab `leaf`; once it was made and is still wanted, it runs. */
export async function startTable(host: ControlHost, leaf: WorkspaceLeaf | null, campaignId: string | null): Promise<OnlineTable | null> {
  if (host.current() !== null || host.isStarting()) return host.current();
  const started = await prepareStart(host, leaf, campaignId, (on) => host.setStarting(on));
  // `campaignId` is checked for its type only: `prepareStart` refused a missing one.
  if (started === null || campaignId === null) return null;
  // A new table's log is empty: the last table's goes.
  host.logs.forget();
  return runTable(host, { ...started.created, origin: started.origin, campaignId, mapPath: started.mapPath, gate: newGate(undefined, started.seats.codes()) }, started.seats);
}

/** Comes back to the table `saved` on the server it was made on, once its campaign's players file was read. */
export async function resumeTable(host: ControlHost, saved: SavedTable): Promise<OnlineTable | null> {
  if (host.current() !== null || host.isStarting()) return host.current();
  // A table is run again only on the server it was made on.
  if (relayOrigin() !== saved.origin) {
    host.campaigns.stop();
    return null;
  }
  host.setStarting(true);
  const closings = host.closings();
  const seats = await host.campaigns.open(saved.campaignId).catch(() => null).finally(() => host.setStarting(false));
  if (closings !== host.closings() || host.current() !== null) return host.current();
  if (seats === null) {
    host.campaigns.stop();
    return null;
  }
  return runTable(host, saved, seats, host.logs.saved());
}

/** Runs the table on its campaign: its players and books are the campaign's from before anyone can join until it ends. */
function runTable(host: ControlHost, given: SavedTable, seats: TableSeats, savedLog?: unknown): OnlineTable {
  const { campaigns } = host;
  // A join code that is now a player's own (made on another device since) is made anew: the page's one field takes both.
  const saved = { ...given, gate: freeGate(given.gate, seats.codes()) };
  host.setEnded(null);
  host.keep(saved);
  host.ownership.bind(seats);
  campaigns.bound(saved.campaignId);
  const table: OnlineTable = new OnlineTable({
    app: host.app, origin: saved.origin, table: saved, mapPath: saved.mapPath, ownership: host.ownership, seats, gate: saved.gate, paused: saved.paused === true, shelf: host.shelf, savedLog,
    events: tableEvents(host, () => table),
  });
  // The table's campaign is the one played while it runs: its rules, quests and world map are what players get.
  campaigns.play(saved.campaignId);
  // A campaign deleted while its table runs is played no longer (`recordCampaignPlay`, the campaign page), and takes its table with it.
  host.setUnwatch(campaigns.onChange(() => {
    if (host.current() === table && campaigns.playing() !== saved.campaignId) host.stop();
  }));
  host.setCurrent(table);
  table.start();
  host.changed();
  return table;
}

/**
 * Gives the campaign a new link, so the old one stops working; a running table starts again on it.
 * Where it could not start again (no Atlas tab, signed out) nothing changes and the GM is told why.
 */
export async function renewTable(ports: ControlHost): Promise<void> {
  const { campaigns } = ports;
  const campaignId = ports.saved()?.campaignId ?? campaigns.playing();
  const leaf = ports.current()?.sharedTab ?? activeAtlasLeaf(ports.app);
  const blocked = ports.current() === null ? null : startBlock(leaf, campaignId, ports.account);
  if (blocked !== null) return void showNotice(blocked);
  if (campaignId === null) return void showNotice(NO_CAMPAIGN_TEXT);
  const seats = await campaigns.open(campaignId).catch(() => null);
  if (seats === null || !renewLink(seats)) return void showNotice(seats === null ? CAMPAIGNS_LOADING_TEXT : linkRefusal(seats));
  if (ports.current() === null) return;
  // The campaign stays played across the restart, unless no table runs after it.
  ports.end();
  let restarted: OnlineTable | null = null;
  try {
    restarted = await startTable(ports, leaf, campaignId);
  } finally {
    if (restarted === null) campaigns.stop();
  }
}
