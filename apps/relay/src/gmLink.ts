import type { WebSocket } from 'ws';
import { CLOSE, type ClientFrame, type PlayerHello, type PlayerInfo } from '../../../src/app/online/protocol/relay.ts';
import type { CampaignSeat } from '../../../src/app/online/protocol/seat.ts';
import type { RelayTiming } from './config.ts';
import { JoinGate } from './joinGate.ts';
import { PlayerLink } from './playerLink.ts';
import { announceGm, gameFromGm, sendFrame, toGm } from './routing.ts';
import type { TableListener, TableRegistry } from './tables.ts';

export { sendFrame };

/** A player at a table. */
export interface TablePlayer extends PlayerInfo {
  readonly socket: WebSocket;
}

/** A newcomer who waits for the GM's answer. */
export interface Knock extends PlayerInfo {
  socket: WebSocket;
  readonly timer: NodeJS.Timeout;
  /** Hash of the token a page may take the wait up again with. */
  readonly waitHash: string | null;
}

/** Everything the relay keeps in memory for one table (nothing of it is persisted). */
export interface TableState {
  /** The welcomed GM socket, or null. */
  gm: WebSocket | null;
  /** The GM's last `gate` frame. */
  gate: { code: string | null; ask: boolean };
  /** True once a GM has sent a `gate` frame to this relay process; the gate is never persisted. */
  gateKnown: boolean;
  /** The GM's last `players` frame: the campaign's seats. */
  roster: CampaignSeat[];
  /** Connected players by id. */
  readonly players: Map<string, TablePlayer>;
  /** Newcomers waiting for the GM, by the id they will get. */
  readonly waiting: Map<string, Knock>;
  /** The wrong-code count and pause of the table's join gate. */
  readonly joinGate: JoinGate;
  /** Every open socket of the table, welcomed or not; all are closed when the table ends. */
  readonly sockets: Set<WebSocket>;
}

/** Per-table state and the GM's side of the protocol. Players join through the same `stateOf`. */
export class TableLinks implements TableListener {
  readonly #tables: TableRegistry;
  readonly #states = new Map<string, TableState>();
  readonly #timing: RelayTiming;
  readonly #players: PlayerLink;

  constructor(tables: TableRegistry, timing: RelayTiming) {
    this.#tables = tables;
    this.#timing = timing;
    this.#players = new PlayerLink(tables, timing);
    tables.subscribe(this);
  }

  stateOf(code: string): TableState {
    let state = this.#states.get(code);
    if (state === undefined) {
      state = { gm: null, gate: { code: null, ask: false }, gateKnown: false, roster: [], players: new Map(), waiting: new Map(), joinGate: new JoinGate(this.#timing), sockets: new Set() };
      this.#states.set(code, state);
    }
    return state;
  }

  /** The table's secret was replaced: the GM who holds the old one is out. */
  replaced(code: string): void {
    const state = this.#states.get(code);
    const gm = state?.gm;
    if (state === undefined || gm === null || gm === undefined) return;
    // It stops being the GM before it is closed: ws waits for the peer's answer, and until then its frames must count for nothing.
    state.gm = null;
    this.#tables.setHosted(code, false);
    gm.close(CLOSE.replaced);
    announceGm(state, false);
  }

  /** The table is gone: every socket of it is closed as ended. */
  ended(code: string): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    this.#states.delete(code);
    this.#players.ended(state);
    for (const socket of state.sockets) socket.close(CLOSE.ended);
  }

  /** A GM hello with the right secret arrived on `socket`: it becomes the table's GM and gets its welcome. */
  acceptGm(code: string, socket: WebSocket): void {
    const state = this.stateOf(code);
    const previous = state.gm;
    state.gm = socket;
    previous?.close(CLOSE.replaced);
    this.#tables.setHosted(code, true);
    const players = [...state.players.values()].map(({ id, name }) => ({ id, name }));
    const waiting = [...state.waiting.values()].map(({ id, name }) => ({ id, name }));
    sendFrame(socket, { v: 1, t: 'welcome', role: 'gm', players, ...(waiting.length > 0 && { waiting }), batch: true });
    const until = state.joinGate.pausedUntil(Date.now());
    if (until !== null) sendFrame(socket, { v: 1, t: 'gate-paused', until });
    announceGm(state, true);
  }

  /** A player's hello on `socket`. True when accepted (welcomed or waiting), false when the socket was closed. */
  playerHello(code: string, socket: WebSocket, hello: PlayerHello, address: string): boolean {
    return this.#players.hello(code, this.stateOf(code), socket, hello, address);
  }

  /** A `send` from a welcomed player; it reaches the GM only while the sender is still that table's player. */
  playerSend(code: string, socket: WebSocket, body: unknown): void {
    const state = this.#states.get(code);
    if (state !== undefined) this.#players.send(state, socket, body);
  }

  /** A socket of the table closed; if it was the GM's, the table is unhosted again. */
  socketClosed(code: string, socket: WebSocket): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    state.sockets.delete(socket);
    this.#players.closed(state, socket);
    if (state.gm !== socket) return;
    state.gm = null;
    this.#tables.setHosted(code, false);
    announceGm(state, false);
  }

  /** A frame from the welcomed GM. Frames the relay does not know are ignored. */
  gmFrame(code: string, frame: ClientFrame): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    switch (frame.t) {
      case 'gate':
        state.gate = { code: frame.code, ask: frame.ask };
        state.gateKnown = true;
        return;
      case 'players':
        state.roster = [...frame.players];
        return;
      case 'end':
        this.#tables.end(code);
        return;
      case 'send':
        if (frame.to !== undefined) gameFromGm(state, [{ to: frame.to, body: frame.body }]);
        return;
      case 'sends':
        gameFromGm(state, frame.sends);
        return;
      case 'kick':
        this.#players.kick(code, state, frame.id);
        return;
      case 'admit':
        this.#players.admit(code, state, frame.id);
        return;
      case 'decline':
        this.#players.decline(state, frame.id);
        return;
      default:
        return;
    }
  }
}
