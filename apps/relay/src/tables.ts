import { randomBytes, timingSafeEqual } from 'node:crypto';
import { loadTables, saveTables, sha256Hex, type StoredPlayer, type StoredTable, type StoredTables } from './persist.ts';

export const MAX_TABLES = 10;
const SAVE_INTERVAL_MS = 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;
/** Most players a table remembers keys for; the oldest who are not connected go first. */
const MAX_KNOWN_PLAYERS = 128;

export interface TableRegistryOptions {
  readonly statePath: string;
  readonly maxPlayers: number;
  readonly unhostedTableMs: number;
}

/** What the socket side hears about a table: its secret was replaced (a re-POST), or it is gone (ended, or unhosted too long). */
export interface TableListener {
  replaced(code: string): void;
  ended(code: string): void;
}

export interface CreatedTable {
  readonly code: string;
  readonly secret: string;
  readonly maxPlayers: number;
}

/**
 * The tables this relay knows: code to secret hash, kept in a state file. A table no GM has hosted
 * for `unhostedTableMs` is deleted; the WebSocket side reports hosting with `setHosted`.
 */
export class TableRegistry {
  readonly #options: TableRegistryOptions;
  readonly #tables = new Map<string, StoredTable>();
  readonly #hosted = new Set<string>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  #listener: TableListener | null = null;
  #pending: Promise<void> = Promise.resolve();
  #dirty = false;
  #lastWrite = 0;
  #saveTimer: NodeJS.Timeout | null = null;

  constructor(options: TableRegistryOptions) {
    this.#options = options;
    for (const [code, table] of Object.entries(loadTables(options.statePath))) this.#tables.set(code, table);
    for (const code of [...this.#tables.keys()]) this.#schedule(code);
  }

  get size(): number {
    return this.#tables.size;
  }

  get maxPlayers(): number {
    return this.#options.maxPlayers;
  }

  has(code: string): boolean {
    return this.#tables.has(code);
  }

  /** The one listener (the socket side) that hears of replaced secrets and ended tables. */
  subscribe(listener: TableListener): void {
    this.#listener = listener;
  }

  /** Makes a table, or gives an existing code a new secret (the old one stops working). 'full' at the table limit. */
  create(code: string): CreatedTable | 'full' {
    if (!this.#tables.has(code) && this.#tables.size >= MAX_TABLES) return 'full';
    const existed = this.#tables.has(code);
    const secret = randomBytes(32).toString('base64url');
    this.#tables.set(code, { players: this.#tables.get(code)?.players, secretHash: sha256Hex(secret), lastHostedAt: Date.now() });
    this.#schedule(code);
    this.#save();
    if (existed) this.#listener?.replaced(code);
    return { code, secret, maxPlayers: this.#options.maxPlayers };
  }

  checkSecret(code: string, secret: string): boolean {
    const table = this.#tables.get(code);
    if (table === undefined) return false;
    return timingSafeEqual(Buffer.from(sha256Hex(secret)), Buffer.from(table.secretHash));
  }

  /** The player whose key this is (compared in constant time), or null. */
  playerForKey(code: string, key: string): { id: string; name: string } | null {
    const players = this.#tables.get(code)?.players ?? {};
    const hash = Buffer.from(sha256Hex(key));
    let found: { id: string; name: string } | null = null;
    for (const [id, player] of Object.entries(players)) if (timingSafeEqual(hash, Buffer.from(player.keyHash))) found = { id, name: player.name };
    return found;
  }

  /** Remembers a player's key hash; past the limit the least recently seen players outside `live` (connected or on the roster) are forgotten. */
  rememberPlayer(code: string, id: string, player: StoredPlayer, live: { has(id: string): boolean }): void {
    const table = this.#tables.get(code);
    if (table === undefined) return;
    // Re-adding moves the id to the end, so the front is the least recently seen.
    const { [id]: _replaced, ...others } = table.players ?? {};
    const players: Record<string, StoredPlayer> = { ...others, [id]: player };
    for (const old of Object.keys(players)) {
      if (Object.keys(players).length <= MAX_KNOWN_PLAYERS) break;
      if (old !== id && !live.has(old)) delete players[old];
    }
    this.#tables.set(code, { ...table, players });
    this.#save();
  }

  /** The player's key stops working. */
  forgetPlayer(code: string, id: string): void {
    const table = this.#tables.get(code);
    if (table?.players?.[id] === undefined) return;
    const { [id]: _gone, ...players } = table.players;
    this.#tables.set(code, { ...table, players });
    this.#save();
  }

  /** The WebSocket side calls this when a GM socket arrives (true) or goes (false); the 14 days count from the last one. */
  setHosted(code: string, hosted: boolean): void {
    const table = this.#tables.get(code);
    if (table === undefined) return;
    if (hosted) this.#hosted.add(code);
    else {
      this.#hosted.delete(code);
      this.#tables.set(code, { ...table, lastHostedAt: Date.now() });
      this.#save();
    }
    this.#schedule(code);
  }

  end(code: string): void {
    if (!this.#tables.delete(code)) return;
    this.#hosted.delete(code);
    this.#clearTimer(code);
    this.#save();
    this.#listener?.ended(code);
  }

  /** Resolves once everything changed so far is on disk; rejects if the last write failed. */
  flush(): Promise<void> {
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#write();
    return this.#pending;
  }

  async close(): Promise<void> {
    for (const code of [...this.#timers.keys()]) this.#clearTimer(code);
    await this.flush();
  }

  #clearTimer(code: string): void {
    const timer = this.#timers.get(code);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(code);
  }

  #schedule(code: string): void {
    this.#clearTimer(code);
    const table = this.#tables.get(code);
    if (table === undefined || this.#hosted.has(code)) return;
    const delay = Math.max(0, table.lastHostedAt + this.#options.unhostedTableMs - Date.now());
    const timer = setTimeout(() => {
      if (Date.now() >= table.lastHostedAt + this.#options.unhostedTableMs) this.end(code);
      else this.#schedule(code);
    }, Math.min(delay, MAX_TIMER_MS));
    timer.unref();
    this.#timers.set(code, timer);
  }

  /** Asks for the state file to be written: at most once a second; `flush` and `close` write at once. */
  #save(): void {
    this.#dirty = true;
    if (this.#saveTimer !== null) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#write();
    }, Math.max(0, this.#lastWrite + SAVE_INTERVAL_MS - Date.now()));
    this.#saveTimer.unref();
  }

  #write(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#lastWrite = Date.now();
    const snapshot: StoredTables = Object.fromEntries(this.#tables);
    this.#pending = this.#pending.catch(() => undefined).then(() => saveTables(this.#options.statePath, snapshot));
    this.#pending.catch(() => undefined);
  }
}
