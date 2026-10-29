import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { open, rename } from 'node:fs/promises';
import { PLAYER_ID_PATTERN } from '../../../src/app/online/protocol/identity.ts';
import { TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';

/** What survives a restart of one table: the hash of its secret and when a GM last had it. */
export interface StoredTable {
  readonly secretHash: string;
  readonly lastHostedAt: number;
  /** Players the table knows by id: their name and the hash of their key (never the key). */
  readonly players?: Readonly<Record<string, StoredPlayer>>;
}

export interface StoredPlayer {
  readonly name: string;
  readonly keyHash: string;
}

export type StoredTables = Record<string, StoredTable>;

/** The whole state file: the tables and the key tickets are signed with (base64url of 32 bytes, null until first made). */
export interface StoredState {
  readonly tables: StoredTables;
  readonly ticketKey: string | null;
}

const EMPTY_STATE: StoredState = { tables: {}, ticketKey: null };

function storedKey(value: unknown): string | null {
  return typeof value === 'string' && Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value ? value : null;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isStoredTable(value: unknown): value is StoredTable {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.secretHash === 'string' && /^[0-9a-f]{64}$/.test(entry.secretHash) && typeof entry.lastHostedAt === 'number' && Number.isFinite(entry.lastHostedAt);
}

function storedPlayers(value: unknown): Record<string, StoredPlayer> {
  const players: Record<string, StoredPlayer> = {};
  if (typeof value !== 'object' || value === null) return players;
  for (const [id, entry] of Object.entries(value)) {
    // Keys come from a file: only well-formed ids are kept, so `__proto__` or `name` never become entries.
    if (!PLAYER_ID_PATTERN.test(id)) continue;
    const player = entry as { name?: unknown; keyHash?: unknown } | null;
    if (typeof player?.name === 'string' && typeof player.keyHash === 'string' && /^[0-9a-f]{64}$/.test(player.keyHash)) players[id] = { name: player.name, keyHash: player.keyHash };
  }
  return players;
}

/** Reads the state file; a missing file is an empty state, an unreadable one is an error (never silently wiped). */
export function loadState(statePath: string): StoredState {
  let text: string;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's message quotes the input, which holds the ticket key: it is never passed on.
    throw new Error(`state file ${statePath} is not valid JSON; fix or remove it`);
  }
  const root = typeof parsed === 'object' && parsed !== null ? (parsed as { tables?: unknown; ticketKey?: unknown }) : {};
  const tables = root.tables;
  const result: StoredTables = {};
  const ticketKey = storedKey(root.ticketKey);
  if (typeof tables !== 'object' || tables === null) return { tables: result, ticketKey };
  for (const [code, entry] of Object.entries(tables)) {
    if (!TABLE_CODE_PATTERN.test(code) || !isStoredTable(entry)) continue;
    result[code] = { secretHash: entry.secretHash, lastHostedAt: entry.lastHostedAt, players: storedPlayers((entry as { players?: unknown }).players) };
  }
  return { tables: result, ticketKey };
}

/**
 * Writes `<path>.tmp`, forces it to disk, and renames it over the state file: a crash never leaves half
 * a file, and a power loss never leaves an empty one (the rename could otherwise reach the disk first).
 */
export async function saveState(statePath: string, state: StoredState): Promise<void> {
  const temporary = `${statePath}.tmp`;
  const file = await open(temporary, 'w', 0o600);
  try {
    await file.writeFile(JSON.stringify({ version: 1, tables: state.tables, ticketKey: state.ticketKey }));
    await file.datasync();
  } finally {
    await file.close();
  }
  await rename(temporary, statePath);
  // Best effort: also make the rename itself durable. Not every platform can open a directory.
  try {
    const folder = await open(dirname(statePath), 'r');
    try {
      await folder.datasync();
    } finally {
      await folder.close();
    }
  } catch {
    // The file is in place; only its durability against power loss is weaker.
  }
}
