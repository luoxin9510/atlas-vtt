import type { WebSocket } from 'ws';
import { CLOSE, type ClientFrame, type PlayerInfo, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { CampaignSeat } from '../../../src/app/online/protocol/seat.ts';
import type { TableListener, TableRegistry } from './tables.ts';

/** A player at a table; Task 7 fills `TableState.players` with these. */
export interface TablePlayer extends PlayerInfo {
  readonly socket: WebSocket;
}

/** Everything the relay keeps in memory for one table (nothing of it is persisted). */
export interface TableState {
  /** The welcomed GM socket, or null. */
  gm: WebSocket | null;
  /** The GM's last `gate` frame. */
  gate: { code: string | null; ask: boolean };
  /** The GM's last `players` frame: the campaign's seats. */
  roster: CampaignSeat[];
  /** Connected players by id. */
  readonly players: Map<string, TablePlayer>;
  /** Every open socket of the table, welcomed or not; all are closed when the table ends. */
  readonly sockets: Set<WebSocket>;
}

export function sendFrame(socket: WebSocket, frame: RelayFrame): void {
  socket.send(JSON.stringify(frame));
}

/** Per-table state and the GM's side of the protocol. Players join through the same `stateOf`. */
export class TableLinks implements TableListener {
  readonly #tables: TableRegistry;
  readonly #states = new Map<string, TableState>();

  constructor(tables: TableRegistry) {
    this.#tables = tables;
    tables.subscribe(this);
  }

  stateOf(code: string): TableState {
    let state = this.#states.get(code);
    if (state === undefined) {
      state = { gm: null, gate: { code: null, ask: false }, roster: [], players: new Map(), sockets: new Set() };
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
  }

  /** The table is gone: every socket of it is closed as ended. */
  ended(code: string): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    this.#states.delete(code);
    for (const socket of state.sockets) socket.close(CLOSE.ended);
  }

  /** A GM hello with the right secret arrived on `socket`: it becomes the table's GM and gets its welcome. */
  acceptGm(code: string, socket: WebSocket): void {
    const state = this.stateOf(code);
    const previous = state.gm;
    state.gm = socket;
    previous?.close(CLOSE.replaced);
    this.#tables.setHosted(code, true);
    sendFrame(socket, { v: 1, t: 'welcome', role: 'gm', players: [...state.players.values()].map(({ id, name }) => ({ id, name })), batch: true });
  }

  /** A socket of the table closed; if it was the GM's, the table is unhosted again. */
  socketClosed(code: string, socket: WebSocket): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    state.sockets.delete(socket);
    if (state.gm !== socket) return;
    state.gm = null;
    this.#tables.setHosted(code, false);
  }

  /** A frame from the welcomed GM. Frames the relay does not know are ignored. */
  gmFrame(code: string, frame: ClientFrame): void {
    const state = this.#states.get(code);
    if (state === undefined) return;
    switch (frame.t) {
      case 'gate':
        state.gate = { code: frame.code, ask: frame.ask };
        return;
      case 'players':
        state.roster = [...frame.players];
        return;
      case 'end':
        this.#tables.end(code);
        return;
      default:
        // send, sends, kick, admit, decline reach players, who join in Task 7; to unknown players they are dropped.
        return;
    }
  }
}
