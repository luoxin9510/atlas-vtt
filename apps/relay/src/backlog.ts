import type { WebSocket } from 'ws';

/** Most bytes all outboxes of one relay may hold together; a distinct payload counts once however many sockets queue it. */
export const RELAY_BACKLOG_BUDGET = 256 * 1024 * 1024;

/** One queued frame. A broadcast creates it once and every socket queues the same object. */
export interface Payload {
  readonly text: string;
  /** Outboxes that hold it right now (frames fed straight to a socket are not held). */
  refs: number;
}

export function payloadOf(text: string): Payload {
  return { text, refs: 0 };
}

/** What the budget needs to know of a socket's outbox. */
export interface Held {
  /** Bytes (characters) waiting in the outbox, per socket (a shared payload counts for each holder here). */
  readonly queued: number;
}

/**
 * The relay-wide memory budget. `bytes` is the sum over distinct payloads that at least one outbox
 * holds: a payload is added when its first holder queues it and removed when its last holder sends it,
 * drops it, or is dropped itself. When `bytes` passes `limit`, `victim` names the socket to cut off:
 * the largest backlog among non-GM sockets, the GM's own socket only when nothing else is queued.
 */
export class Backlog {
  readonly limit: number;
  #bytes = 0;
  readonly #held = new Map<WebSocket, Held>();
  readonly #gms = new WeakSet<WebSocket>();

  constructor(limit: number = RELAY_BACKLOG_BUDGET) {
    this.limit = limit;
  }

  get bytes(): number {
    return this.#bytes;
  }

  /** Marks `socket` as a GM's: it is closed only when no other socket has a backlog. */
  markGm(socket: WebSocket): void {
    this.#gms.add(socket);
  }

  /** `socket`'s outbox takes a reference to `payload`. */
  hold(socket: WebSocket, box: Held, payload: Payload): void {
    if (payload.refs === 0) this.#bytes += payload.text.length;
    payload.refs += 1;
    this.#held.set(socket, box);
  }

  /** An outbox gives up its reference to `payload` (sent or dropped). Never goes below zero. */
  release(payload: Payload): void {
    if (payload.refs <= 0) return;
    payload.refs -= 1;
    if (payload.refs === 0) this.#bytes -= payload.text.length;
  }

  /** The socket has nothing queued any more (or is gone). */
  forget(socket: WebSocket): void {
    this.#held.delete(socket);
  }

  over(): boolean {
    return this.#bytes > this.limit;
  }

  /** The socket with the largest backlog (queued plus buffered), players before the GM; null when nothing is queued. */
  victim(): WebSocket | null {
    let players: WebSocket | null = null;
    let gm: WebSocket | null = null;
    let playersSize = -1;
    let gmSize = -1;
    for (const [socket, box] of this.#held) {
      const size = box.queued + socket.bufferedAmount;
      if (this.#gms.has(socket)) {
        if (size > gmSize) [gm, gmSize] = [socket, size];
      } else if (size > playersSize) [players, playersSize] = [socket, size];
    }
    return players ?? gm;
  }
}
