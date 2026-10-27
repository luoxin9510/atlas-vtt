import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { open, rename } from 'node:fs/promises';

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
    const player = entry as { name?: unknown; keyHash?: unknown } | null;
    if (typeof player?.name === 'string' && typeof player.keyHash === 'string' && /^[0-9a-f]{64}$/.test(player.keyHash)) players[id] = { name: player.name, keyHash: player.keyHash };
  }
  return players;
}

/** Reads the state file; a missing file is an empty state, an unreadable one is an error (never silently wiped). */
export function loadTables(statePath: string): StoredTables {
  let text: string;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`state file ${statePath} is not valid JSON (${error instanceof Error ? error.message : 'unreadable'}); fix or remove it`);
  }
  const tables = typeof parsed === 'object' && parsed !== null ? (parsed as { tables?: unknown }).tables : undefined;
  const result: StoredTables = {};
  if (typeof tables !== 'object' || tables === null) return result;
  for (const [code, entry] of Object.entries(tables)) {
    if (!isStoredTable(entry)) continue;
    result[code] = { secretHash: entry.secretHash, lastHostedAt: entry.lastHostedAt, players: storedPlayers((entry as { players?: unknown }).players) };
  }
  return result;
}

/**
 * Writes `<path>.tmp`, forces it to disk, and renames it over the state file: a crash never leaves half
 * a file, and a power loss never leaves an empty one (the rename could otherwise reach the disk first).
 */
export async function saveTables(statePath: string, tables: StoredTables): Promise<void> {
  const temporary = `${statePath}.tmp`;
  const file = await open(temporary, 'w', 0o600);
  try {
    await file.writeFile(JSON.stringify({ version: 1, tables }));
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
