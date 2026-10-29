import { randomBytes, timingSafeEqual } from 'node:crypto';
import { loadState, saveState, sha256Hex, type StoredPlayer, type StoredState, type StoredTable } from './persist.ts';

export const MAX_TABLES = 10;
const SAVE_INTERVAL_MS = 1000;
const MAX_TIMER_MS = 2 ** 31 - 1;
/** While a GM hosts a table its `lastHostedAt` is refreshed this often at most (a quarter of the unhosted limit otherwise). */
const HOSTED_REFRESH_MAX_MS = 3_600_000;
/** Most players a table remembers keys for; the oldest who are not connected go first. */
export const MAX_KNOWN_PLAYERS = 128;

export interface TableRegistryOptions {
  readonly statePath: string;
  readonly maxPlayers: number;
  readonly unhostedTableMs: number;
  /** One line per streak of failed state writes (the error code only, never table data). */
  readonly log?: (line: string) => void;
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
  readonly #listeners = new Set<TableListener>();
  #ticketKey: string | null;
  #pending: Promise<void> = Promise.resolve();
  #dirty = false;
  #lastWrite = 0;
  #saveTimer: NodeJS.Timeout | null = null;
  #failing = false;

  constructor(options: TableRegistryOptions) {
    this.#options = options;
    const state = loadState(options.statePath);
    this.#ticketKey = state.ticketKey;
    for (const [code, table] of Object.entries(state.tables)) this.#tables.set(code, table);
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

  /** A listener (the socket side, the image store) that hears of replaced secrets and ended tables; the result stops the listening. */
  subscribe(listener: TableListener): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The 32 byte key tickets are signed with: made on first use, kept in the state file ever after. */
  ensureTicketKey(): Buffer {
    if (this.#ticketKey === null) {
      this.#ticketKey = randomBytes(32).toString('base64url');
      this.#save();
    }
    return Buffer.from(this.#ticketKey, 'base64url');
  }

  /** Makes a table, or gives an existing code a new secret (the old one stops working). 'full' at the table limit. */
  create(code: string): CreatedTable | 'full' {
    const made = this.#make(code);
    if (made !== 'full' && made.existed) this.#notifyReplaced(code);
    return made === 'full' ? 'full' : made.created;
  }

  /**
   * Like `create`, but the old GM hears `replaced` only once the new secret is on disk. If the write fails the previous table
   * (or none) is put back, nobody is notified and the error is rethrown.
   */
  async createDurable(code: string): Promise<CreatedTable | 'full'> {
    const made = this.#make(code);
    if (made === 'full') return 'full';
    try {
      await this.flush();
    } catch (error) {
      this.#rollback(code, made);
      throw error;
    }
    if (made.existed) this.#notifyReplaced(code);
    return made.created;
  }

  #make(code: string): { created: CreatedTable; previous: StoredTable | undefined; existed: boolean } | 'full' {
    const previous = this.#tables.get(code);
    if (previous === undefined && this.#tables.size >= MAX_TABLES) return 'full';
    const secret = randomBytes(32).toString('base64url');
    this.#tables.set(code, { players: previous?.players, secretHash: sha256Hex(secret), lastHostedAt: Date.now() });
    this.#schedule(code);
    this.#save();
    return { created: { code, secret, maxPlayers: this.#options.maxPlayers }, previous, existed: previous !== undefined };
  }

  /** Puts the previous record back, unless a later re-POST has already replaced this one. */
  #rollback(code: string, made: { created: CreatedTable; previous: StoredTable | undefined }): void {
    if (this.#tables.get(code)?.secretHash !== sha256Hex(made.created.secret)) return;
    if (made.previous === undefined) {
      this.#tables.delete(code);
      this.#clearTimer(code);
    } else {
      this.#tables.set(code, made.previous);
      this.#schedule(code);
    }
    this.#save();
  }

  #notifyReplaced(code: string): void {
    for (const listener of this.#listeners) listener.replaced(code);
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
    if (hosted) {
      this.#hosted.add(code);
      this.#tables.set(code, { ...table, lastHostedAt: Date.now() });
      this.#save();
    } else {
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
    for (const listener of this.#listeners) listener.ended(code);
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
    if (table === undefined) return;
    if (this.#hosted.has(code)) {
      // A crash while hosted must not look like 14 days of nobody hosting it: keep the stored time recent.
      const every = Math.min(HOSTED_REFRESH_MAX_MS, Math.max(50, this.#options.unhostedTableMs / 4));
      const refresh = setTimeout(() => {
        const current = this.#tables.get(code);
        if (current === undefined || !this.#hosted.has(code)) return;
        this.#tables.set(code, { ...current, lastHostedAt: Date.now() });
        this.#save();
        this.#schedule(code);
      }, every);
      refresh.unref();
      this.#timers.set(code, refresh);
      return;
    }
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
    const snapshot: StoredState = { tables: Object.fromEntries(this.#tables), ticketKey: this.#ticketKey };
    this.#pending = this.#pending
      .catch(() => undefined)
      .then(() => saveState(this.#options.statePath, snapshot))
      .then(
        () => {
          this.#failing = false;
        },
        (error: unknown) => {
          // The change is still not on disk: try again with the next save, but say so only once per streak.
          this.#dirty = true;
          if (!this.#failing) this.#options.log?.(`state file could not be written (${(error as NodeJS.ErrnoException).code ?? 'error'}); tables and keys are not saved until it can`);
          this.#failing = true;
          throw error;
        },
      );
    this.#pending.catch(() => undefined);
  }
}
