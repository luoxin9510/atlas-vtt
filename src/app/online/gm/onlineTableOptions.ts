import type { App } from 'obsidian';
import type { BookShelf } from './book/BookShelf.ts';
import type { TableSeats } from './campaignSeats.ts';
import type { CreatedTable } from './createdTable.ts';
import type { GateSettings } from './joinGate.ts';
import type { Ownership } from './ownership.ts';
import type { OnlineTableEvents } from './tableEvents.ts';

/** Everything a running table is made from. */
export interface OnlineTableOptions {
  readonly app: App;
  readonly origin: string;
  readonly table: CreatedTable;
  readonly mapPath: string | null;
  readonly ownership: Ownership;
  readonly seats: TableSeats;
  readonly gate: GateSettings;
  readonly paused: boolean;
  readonly events: OnlineTableEvents;
  readonly shelf: BookShelf;
  readonly savedLog?: unknown;
}
