import type { App } from 'obsidian';
import { GM_LEVEL } from '../protocol/index.ts';
import { rememberMinLevel } from './gmLevel.ts';
import type { LogKeeper } from './log/logStore.ts';
import type { OnlineTable } from './OnlineTable.ts';
import type { SavedTable } from './savedTable.ts';
import type { TableCampaigns } from './tableCampaigns.ts';
import type { LostTable } from './tableEnd.ts';
import type { OnlineTableEvents } from './tableEvents.ts';
import type { HostAccount } from './tableStart.ts';

/** What the table's events change in the control. */
export interface EventsHost {
  readonly app: App;
  readonly campaigns: TableCampaigns;
  readonly account: HostAccount;
  readonly logs: LogKeeper;
  /** The running table, or null. */
  current(): OnlineTable | null;
  /** The saved table, or null. */
  saved(): SavedTable | null;
  keep(saved: SavedTable | null): void;
  changed(): void;
  /** No table runs any more: forgets it, stops following what is played and tells Atlas. */
  detach(): void;
  /** How the table ended when the server ended it, else null. */
  setEnded(end: LostTable | null): void;
}

/** What the control does when the table `getTable()` tells it something; a table that is no longer the running one changes nothing. */
export function tableEvents(host: EventsHost, getTable: () => OnlineTable | null): OnlineTableEvents {
  const mine = (): boolean => host.current() === getTable();
  const keepWith = (change: Partial<SavedTable>): void => {
    const saved = host.saved();
    if (mine() && saved !== null) host.keep({ ...saved, ...change });
  };
  return {
    status: () => {
      // A welcome says what the relay needs now; an older relay names nothing and needs nothing.
      const table = getTable();
      if (table?.status === 'online') rememberMinLevel(host.app, table.minLevel ?? 0);
      host.changed();
    },
    gate: (gate) => keepWith({ gate }),
    paused: (paused) => keepWith({ paused }),
    changed: () => host.changed(),
    log: () => {
      const table = getTable();
      if (table !== null && mine()) host.logs.keep(table.log.saved());
    },
    mapPath: (mapPath) => keepWith({ mapPath }),
    ended: (end) => {
      if (!mine()) return;
      host.detach();
      // Whoever ends a table themselves decides what is played next (`stop`, `newLink`); a table the server closed, or another Obsidian took over, ends the play here.
      if (end !== 'stopped') host.campaigns.stop();
      // A table the server ended is gone; one the GM stopped was dropped by `stop`, one another Obsidian took over lives on there, and one that waits for an updated Atlas stays.
      const lost = end === 'stopped' || end === 'replaced' || end === 'outdated' ? null : end;
      host.setEnded(lost);
      if (end === 'outdated') rememberMinLevel(host.app, GM_LEVEL + 1);
      if (lost !== null) host.keep(null);
      // The account page says why; the dock shows what the relay says of the account now.
      if (end === 'no-access') void host.account.refresh(true);
    },
  };
}
