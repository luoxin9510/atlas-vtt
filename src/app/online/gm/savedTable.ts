import { isAssetId } from '../../campaigns/campaignValues';
import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../protocol/index.ts';
import { seatsOf, type CreatedTable } from './createdTable.ts';
import { readGate, type GateSettings } from './joinGate.ts';
import { normalizeServerOrigin, UPSTREAM_RELAY_ORIGIN } from './servers.ts';

/** The longest map path kept. */
const MAX_MAP_PATH = 1000;

/**
 * A running table as the companion's data keeps it, so a reload of Obsidian or of the companion comes
 * back to it: its code and host secret, the campaign it runs on, the map file players were shown, and
 * its gates (the join code is kept here like the host secret: the relay has only its hash). Cleared
 * when the GM stops the table or the server ends it.
 */
export interface SavedTable extends CreatedTable {
  /** The campaign the table was started for; it keeps it while the GM plays another. */
  readonly campaignId: string;
  /** The server the table was made on: a table is run again only where it was made. */
  readonly origin: string;
  /** The shared scene's map file, found again by this path; null until a map was shared. */
  readonly mapPath: string | null;
  /** The join code and the two switches; a table saved before it had gates gets new ones, both on. */
  readonly gate: GateSettings;
}

/**
 * The saved table from the plugin's data, each field checked; null when there is none or it is
 * unreadable (a server address among that), and for a table saved before tables belonged to a campaign: the GM starts a new one.
 */
export function readSavedTable(data: unknown): SavedTable | null {
  if (typeof data !== 'object' || data === null) return null;
  const { code, secret, campaignId, mapPath, maxPlayers, gate, origin: savedOrigin } = data as Record<string, unknown>;
  if (typeof code !== 'string' || !TABLE_CODE_PATTERN.test(code) || typeof secret !== 'string' || !SECRET_PATTERN.test(secret) || !isAssetId(campaignId)) return null;
  const path = typeof mapPath === 'string' && mapPath !== '' && mapPath.length <= MAX_MAP_PATH ? mapPath : null;
  // A table saved before servers could differ was made on Atlas's own.
  const origin = savedOrigin === undefined ? UPSTREAM_RELAY_ORIGIN : typeof savedOrigin === 'string' ? normalizeServerOrigin(savedOrigin) : null;
  if (origin === null) return null;
  return { code, secret, campaignId, origin, maxPlayers: seatsOf(maxPlayers), mapPath: path, gate: readGate(gate) };
}
