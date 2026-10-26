import { WebSocket } from 'ws';
import { ALL_PLAYERS, type BatchedSend, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { TableState } from './gmLink.ts';

/**
 * Backpressure. A socket that is slow but reading is left alone, however much the GM has queued for it
 * (a 30 MB map for a phone on a slow link takes minutes); a socket is closed only when
 * - its backlog has not gone down for `timing.stallMs` (see `stalled`), or
 * - its backlog passes the hard cap `RelayConfig.maxBacklogBytes` (memory protection, 96 MiB by default).
 * The close is 1013, "try again later": not final, so the page reconnects and resyncs. Only that socket is
 * dropped; nobody else waits for it.
 */
export const DEFAULT_BACKLOG_CAP = 96 * 1024 * 1024;
export const CLOSE_OVERLOADED = 1013;
/** A closing socket that does not finish by then (its peer reads nothing) is terminated and its buffer freed. */
const OVERLOAD_TERMINATE_MS = 1000;

/**
 * What the relay holds for one socket. ws and Node write everything queued for a socket in one batch and
 * report it done only when the whole batch is out, so a socket's own buffer cannot show that a slow reader
 * is making progress. The relay therefore feeds each socket a little at a time: at most `FEED_BYTES` are
 * in the socket's buffer, the rest waits here, and every frame handed on is progress.
 */
interface Outbox {
  readonly queue: string[];
  /** Bytes (characters) waiting in `queue`. */
  queued: number;
  /** When a frame was last handed to the socket, or the backlog began. */
  since: number;
}
const FEED_BYTES = 1024 * 1024;
const outboxes = new WeakMap<WebSocket, Outbox>();

function outboxOf(socket: WebSocket): Outbox {
  let box = outboxes.get(socket);
  if (box === undefined) {
    box = { queue: [], queued: 0, since: Date.now() };
    outboxes.set(socket, box);
  }
  return box;
}

/** Closes the socket 1013 and cuts it off shortly after (its buffer is freed even if the peer never answers). */
export function overload(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.close(CLOSE_OVERLOADED);
  setTimeout(() => socket.terminate(), OVERLOAD_TERMINATE_MS).unref();
}

function feed(socket: WebSocket, box: Outbox, text: string): void {
  box.since = Date.now();
  socket.send(text, () => pump(socket, box));
}

/** Hands queued frames to the socket while its own buffer is small. */
function pump(socket: WebSocket, box: Outbox): void {
  while (box.queue.length > 0 && socket.readyState === WebSocket.OPEN && socket.bufferedAmount < FEED_BYTES) {
    const text = box.queue.shift() ?? '';
    box.queued -= text.length;
    feed(socket, box, text);
  }
}

/** Whether the socket has a backlog (queued or buffered) that no frame has left for `stallMs`: it is stuck, not slow. */
export function stalled(socket: WebSocket, now: number, stallMs: number): boolean {
  const box = outboxes.get(socket);
  if (box === undefined) return false;
  if (box.queued + socket.bufferedAmount === 0) {
    box.since = now;
    return false;
  }
  return now - box.since >= stallMs;
}

/** Sends `text` in order, or closes the socket instead when its backlog is over `cap`. */
export function push(socket: WebSocket, text: string, cap: number = DEFAULT_BACKLOG_CAP): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const box = outboxOf(socket);
  if (box.queued + socket.bufferedAmount > cap) return overload(socket);
  if (box.queue.length === 0 && socket.bufferedAmount < FEED_BYTES) return feed(socket, box, text);
  box.queue.push(text);
  box.queued += text.length;
}

export function sendFrame(socket: WebSocket, frame: RelayFrame, cap: number = DEFAULT_BACKLOG_CAP): void {
  push(socket, JSON.stringify(frame), cap);
}

/** To the table's GM, if one is connected. */
export function toGm(state: TableState, frame: RelayFrame): void {
  if (state.gm !== null) sendFrame(state.gm, frame, state.backlogCap);
}

/** To every connected player. */
export function toEveryPlayer(state: TableState, frame: RelayFrame): void {
  const text = JSON.stringify(frame);
  for (const player of state.players.values()) push(player.socket, text, state.backlogCap);
}

/** A game message from player `id`: it reaches the GM with `from` stamped; the body goes on as it came. */
export function gameFromPlayer(state: TableState, id: string, body: unknown): void {
  toGm(state, { v: 1, t: 'game', from: id, body });
}

/** GM messages: one player, or all (`ALL_PLAYERS`); an unknown player gets nothing. */
export function gameFromGm(state: TableState, sends: readonly BatchedSend[]): void {
  for (const { to, body } of sends) {
    const text = JSON.stringify({ v: 1, t: 'game', body });
    if (to === ALL_PLAYERS) for (const player of state.players.values()) push(player.socket, text, state.backlogCap);
    else {
      const player = state.players.get(to);
      if (player !== undefined) push(player.socket, text, state.backlogCap);
    }
  }
}

/** Every player hears that the GM came or went. */
export function announceGm(state: TableState, online: boolean): void {
  toEveryPlayer(state, { v: 1, t: 'gm', online });
}
