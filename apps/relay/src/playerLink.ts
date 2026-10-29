import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CLOSE, type PlayerHello } from '../../../src/app/online/protocol/relay.ts';
import type { RelayTiming } from './config.ts';
import type { Knock, TableState } from './gmLink.ts';
import { type GateView, newPlayerKey } from './joinGate.ts';
import { sha256Hex } from './persist.ts';
import { closeWhenSent, gameFromPlayer, sendFrame, toGm } from './routing.ts';
import { NewcomerLimit } from './limits.ts';
import type { TableRegistry } from './tables.ts';

/** The player side of a table: hellos, knocks, and what the GM does with them. Bodies are never looked at. */
export class PlayerLink {
  readonly #tables: TableRegistry;
  readonly #timing: RelayTiming;
  readonly #newcomers = new NewcomerLimit();

  constructor(tables: TableRegistry, timing: RelayTiming) {
    this.#tables = tables;
    this.#timing = timing;
  }

  /** A player's hello. True when it was accepted (welcomed, or waiting for the GM); false when the socket was closed. */
  hello(code: string, state: TableState, socket: WebSocket, hello: PlayerHello, address: string): boolean {
    const wait = hello.wait;
    const resumed = wait === undefined ? undefined : this.#knockWithWait(state, wait);
    if (resumed !== undefined && wait !== undefined) {
      const old = resumed.socket;
      resumed.socket = socket;
      closeWhenSent(old, CLOSE.replaced);
      sendFrame(socket, { v: 1, t: 'waiting', wait }, state.limits);
      return true;
    }
    const now = Date.now();
    const wasPaused = state.joinGate.pausedUntil(now) !== null;
    const decision = state.joinGate.decide(hello, this.#view(code, state), now);
    if (decision.kind === 'close') return this.#turnAway(socket, decision.code);
    if (decision.kind === 'pause') {
      // The GM hears of a pause when it starts, not again for every hello that bounces off it.
      if (!wasPaused) toGm(state, { v: 1, t: 'gate-paused', until: decision.until });
      return this.#turnAway(socket, CLOSE.paused);
    }
    const seat = state.roster.some((candidate) => candidate.id === decision.id);
    const isNewcomer = decision.kind === 'knock' || (decision.key !== hello.key && !seat);
    // Every newcomer costs a record and a write; one address gets ten in ten minutes.
    if (isNewcomer && !this.#newcomers.allow(address)) return this.#turnAway(socket, CLOSE.rateLimited);
    const name = state.roster.find((seat) => seat.id === decision.id)?.name ?? hello.name;
    if (decision.kind === 'welcome') {
      this.#welcome(code, state, socket, decision.id, decision.key, name);
      return true;
    }
    this.#knock(state, socket, decision.id, name, hello.waits === true);
    return true;
  }

  /** A frame from a welcomed player: only a `send` goes anywhere, and only from the table's current player. */
  send(state: TableState, socket: WebSocket, body: unknown): void {
    for (const player of state.players.values()) if (player.socket === socket) return gameFromPlayer(state, player.id, body);
  }

  /** The GM lets a waiting newcomer in. */
  admit(code: string, state: TableState, id: string): void {
    const knock = this.#takeKnock(state, id);
    if (knock === undefined) return;
    if (state.players.size >= this.#tables.maxPlayers) {
      toGm(state, { v: 1, t: 'knock-gone', id, full: true });
      closeWhenSent(knock.socket, CLOSE.full);
      return;
    }
    this.#welcome(code, state, knock.socket, id, newPlayerKey(), knock.name);
  }

  decline(state: TableState, id: string): void {
    const knock = this.#takeKnock(state, id);
    if (knock !== undefined) closeWhenSent(knock.socket, CLOSE.declined);
  }

  /** The GM removes a player: their key stops working and their socket closes. */
  kick(code: string, state: TableState, id: string): void {
    this.#tables.forgetPlayer(code, id);
    const player = state.players.get(id);
    if (player === undefined) return;
    state.players.delete(id);
    toGm(state, { v: 1, t: 'player-left', id });
    closeWhenSent(player.socket, CLOSE.kicked);
  }

  /** A socket of the table closed: a player who was connected is gone, a knock that waited is gone. */
  closed(state: TableState, socket: WebSocket): void {
    for (const player of state.players.values()) {
      if (player.socket !== socket) continue;
      state.players.delete(player.id);
      toGm(state, { v: 1, t: 'player-left', id: player.id });
    }
    for (const knock of state.waiting.values()) {
      if (knock.socket !== socket) continue;
      this.#takeKnock(state, knock.id);
      toGm(state, { v: 1, t: 'knock-gone', id: knock.id });
    }
  }

  /** The table is over: no knock is left to time out. */
  ended(state: TableState): void {
    for (const knock of state.waiting.values()) clearTimeout(knock.timer);
    state.waiting.clear();
  }

  /** Players whose key records must stay: the connected and the GM's campaign roster. */
  #protected(state: TableState): { has(id: string): boolean } {
    return { has: (id) => state.players.has(id) || state.roster.some((seat) => seat.id === id) };
  }

  #turnAway(socket: WebSocket, closeCode: number): false {
    closeWhenSent(socket, closeCode);
    return false;
  }

  #view(code: string, state: TableState): GateView {
    return {
      gate: state.gate,
      gateKnown: state.gateKnown,
      roster: state.roster,
      maxPlayers: this.#tables.maxPlayers,
      connected: state.players,
      waiting: state.waiting.size,
      idForKey: (key) => this.#tables.playerForKey(code, key)?.id ?? null,
    };
  }

  #knockWithWait(state: TableState, wait: string): Knock | undefined {
    const hash = sha256Hex(wait);
    for (const knock of state.waiting.values()) if (knock.waitHash === hash) return knock;
    return undefined;
  }

  #takeKnock(state: TableState, id: string): Knock | undefined {
    const knock = state.waiting.get(id);
    if (knock === undefined) return undefined;
    clearTimeout(knock.timer);
    state.waiting.delete(id);
    return knock;
  }

  #welcome(code: string, state: TableState, socket: WebSocket, id: string, key: string, name: string): void {
    const existing = state.players.get(id);
    if (existing !== undefined) {
      // The same player on a new socket: the old one is out before it is closed, so its late frames count for nothing.
      state.players.delete(id);
      closeWhenSent(existing.socket, CLOSE.replaced);
    }
    this.#tables.rememberPlayer(code, id, { name, keyHash: sha256Hex(key) }, this.#protected(state));
    state.players.set(id, { id, name, socket });
    sendFrame(socket, { v: 1, t: 'welcome', role: 'player', id, key, gmOnline: state.gm !== null }, state.limits);
    toGm(state, { v: 1, t: 'player-joined', id, name });
  }

  #knock(state: TableState, socket: WebSocket, id: string, name: string, keepsToken: boolean): void {
    const wait = keepsToken ? randomBytes(24).toString('base64url') : undefined;
    const timer = setTimeout(() => {
      if (this.#takeKnock(state, id) === undefined) return;
      toGm(state, { v: 1, t: 'knock-gone', id });
      closeWhenSent(knock.socket, CLOSE.noAnswer);
    }, this.#timing.knockWaitMs);
    timer.unref();
    const knock: Knock = { id, name, socket, timer, waitHash: wait === undefined ? null : sha256Hex(wait) };
    state.waiting.set(id, knock);
    sendFrame(socket, wait === undefined ? { v: 1, t: 'waiting' } : { v: 1, t: 'waiting', wait }, state.limits);
    toGm(state, { v: 1, t: 'knock', id, name });
  }
}
