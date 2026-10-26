import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

/** What survives a restart of one table: the hash of its secret and when a GM last had it. */
export interface StoredTable {
  readonly secretHash: string;
  readonly lastHostedAt: number;
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

/** Reads the state file; a missing file is an empty state, an unreadable one is an error (never silently wiped). */
export function loadTables(statePath: string): StoredTables {
  let text: string;
  try {
    text = readFileSync(statePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  const tables = typeof parsed === 'object' && parsed !== null ? (parsed as { tables?: unknown }).tables : undefined;
  const result: StoredTables = {};
  if (typeof tables !== 'object' || tables === null) return result;
  for (const [code, entry] of Object.entries(tables)) if (isStoredTable(entry)) result[code] = { secretHash: entry.secretHash, lastHostedAt: entry.lastHostedAt };
  return result;
}

/** Writes `<path>.tmp` and renames it over the state file, so a crash never leaves half a file. */
export async function saveTables(statePath: string, tables: StoredTables): Promise<void> {
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, tables }), { mode: 0o600 });
  await rename(temporary, statePath);
}
