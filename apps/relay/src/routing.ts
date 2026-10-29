import { WebSocket } from 'ws';
import { ALL_PLAYERS, type BatchedSend, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import { Backlog, type Payload, payloadOf } from './backlog.ts';
import type { TableState } from './gmLink.ts';

/**
 * Backpressure. A socket that is slow but reading is left alone, however much the GM has queued for it
 * (a 30 MB map for a phone on a slow link takes minutes); a socket is closed only when
 * - its backlog has not gone down for `timing.stallMs` (see `stalled`), or
 * - its backlog passes the hard cap `RelayConfig.maxBacklogBytes` (memory protection, 96 MiB by default), or
 * - the relay-wide budget (`Backlog`, 256 MiB, distinct payloads counted once) is passed and it holds the largest backlog (players before the GM).
 * The close is 1013, "try again later": not final, so the page reconnects and resyncs. Only that socket is
 * dropped; nobody else waits for it.
 */
export const DEFAULT_BACKLOG_CAP = 96 * 1024 * 1024;
/** What `push` enforces: the cap of one socket and the budget shared by all. */
export interface Limits {
  readonly perSocket: number;
  readonly budget: Backlog;
}
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
  readonly queue: Payload[];
  /** The budget the queued payloads are held in. */
  readonly budget: Backlog;
  /** Bytes (characters) waiting in `queue`. */
  queued: number;
  /** When a frame was last handed to the socket, or the backlog began. */
  since: number;
  /** Set by `closeWhenSent`: the close that waits for the queue to flush. */
  closing: { readonly code: number; readonly reason: string | undefined; readonly timer: NodeJS.Timeout } | null;
}
const FEED_BYTES = 1024 * 1024;
const outboxes = new WeakMap<WebSocket, Outbox>();

function outboxOf(socket: WebSocket, budget: Backlog): Outbox {
  let box = outboxes.get(socket);
  if (box === undefined) {
    box = { queue: [], budget, queued: 0, since: Date.now(), closing: null };
    outboxes.set(socket, box);
  }
  return box;
}

/** Closes the socket 1013 and cuts it off shortly after (its buffer is freed even if the peer never answers). */
export function overload(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.OPEN) return dropOutbox(socket);
  socket.close(CLOSE_OVERLOADED);
  dropOutbox(socket);
  setTimeout(() => socket.terminate(), OVERLOAD_TERMINATE_MS).unref();
}

function feed(socket: WebSocket, box: Outbox, text: string): void {
  box.since = Date.now();
  socket.send(text, () => pump(socket, box));
}

/** Hands queued frames to the socket while its own buffer is small. */
function pump(socket: WebSocket, box: Outbox): void {
  while (box.queue.length > 0 && socket.readyState === WebSocket.OPEN && socket.bufferedAmount < FEED_BYTES) {
    const payload = box.queue.shift();
    if (payload === undefined) break;
    box.queued -= payload.text.length;
    box.budget.release(payload);
    feed(socket, box, payload.text);
  }
  // A drained outbox holds nothing: the budget must not pick it.
  if (box.queue.length === 0) box.budget.forget(socket);
  const closing = box.closing;
  if (closing !== null && box.queue.length === 0 && socket.readyState === WebSocket.OPEN) {
    clearTimeout(closing.timer);
    box.closing = null;
    socket.close(closing.code, closing.reason);
  }
}

/** A close that waits this long for the queue to flush is sent anyway. */
export const CLOSE_FLUSH_MS = 5_000;

/**
 * Closes the socket with `code` once everything queued for it has been handed to ws (ws writes the close
 * frame after its own earlier frames), or after `CLOSE_FLUSH_MS` when the peer is not reading. Frames
 * pushed meanwhile are ignored. With nothing queued it closes at once. `overload` still cuts off at once.
 */
export function closeWhenSent(socket: WebSocket, code: number, reason?: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const box = outboxes.get(socket);
  if (box === undefined || box.queue.length === 0) return socket.close(code, reason);
  if (box.closing !== null) return;
  const timer = setTimeout(() => {
    dropOutbox(socket);
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.close(code, reason);
    // The peer reads nothing: the close frame has had its chance; cut the connection and free ws's buffer.
    setTimeout(() => socket.terminate(), OVERLOAD_TERMINATE_MS).unref();
  }, CLOSE_FLUSH_MS);
  timer.unref();
  box.closing = { code, reason, timer };
}

/** Bytes waiting in the socket's outbox (0 when none). */
export function queuedBytes(socket: WebSocket): number {
  return outboxes.get(socket)?.queued ?? 0;
}

/** The socket is gone: its queued frames are released at once. */
export function dropOutbox(socket: WebSocket): void {
  const box = outboxes.get(socket);
  if (box === undefined) return;
  if (box.closing !== null) clearTimeout(box.closing.timer);
  box.closing = null;
  for (const payload of box.queue) box.budget.release(payload);
  box.queue.length = 0;
  box.queued = 0;
  box.budget.forget(socket);
  outboxes.delete(socket);
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

/** Whether the socket still has a backlog and a frame of it left for the socket after `time`: slow, but alive. */
export function progressedSince(socket: WebSocket, time: number): boolean {
  const box = outboxes.get(socket);
  return box !== undefined && box.since > time && box.queued + socket.bufferedAmount > 0;
}

/** Sends `payload` in order, or closes a socket instead: this one when its backlog is over the cap, the largest one when the relay-wide budget is passed. */
export function pushPayload(socket: WebSocket, payload: Payload, limits: Limits): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const box = outboxOf(socket, limits.budget);
  if (box.closing !== null) return;
  if (box.queued + socket.bufferedAmount > limits.perSocket) return overload(socket);
  if (box.queue.length === 0 && socket.bufferedAmount < FEED_BYTES) return feed(socket, box, payload.text);
  box.queue.push(payload);
  box.queued += payload.text.length;
  limits.budget.hold(socket, box, payload);
  // Each victim leaves the budget at once (`overload` drops its outbox), so this ends; the pusher is cut off too if it is the largest.
  for (let victim = limits.budget.over() ? limits.budget.victim() : null; victim !== null; victim = limits.budget.over() ? limits.budget.victim() : null) overload(victim);
}

export function push(socket: WebSocket, text: string, limits: Limits): void {
  pushPayload(socket, payloadOf(text), limits);
}

export function sendFrame(socket: WebSocket, frame: RelayFrame, limits: Limits): void {
  push(socket, JSON.stringify(frame), limits);
}

/** To the table's GM, if one is connected. */
export function toGm(state: TableState, frame: RelayFrame): void {
  if (state.gm !== null) sendFrame(state.gm, frame, state.limits);
}

/** To every connected player: one payload, shared by all their queues. */
export function toEveryPlayer(state: TableState, frame: RelayFrame): void {
  const payload = payloadOf(JSON.stringify(frame));
  for (const player of state.players.values()) pushPayload(player.socket, payload, state.limits);
}

/** A game message from player `id`: it reaches the GM with `from` stamped; the body goes on as it came. */
export function gameFromPlayer(state: TableState, id: string, body: unknown): void {
  toGm(state, { v: 1, t: 'game', from: id, body });
}

/** GM messages: one player, or all (`ALL_PLAYERS`); an unknown player gets nothing. */
export function gameFromGm(state: TableState, sends: readonly BatchedSend[]): void {
  for (const { to, body } of sends) {
    const payload = payloadOf(JSON.stringify({ v: 1, t: 'game', body }));
    if (to === ALL_PLAYERS) for (const player of state.players.values()) pushPayload(player.socket, payload, state.limits);
    else {
      const player = state.players.get(to);
      if (player !== undefined) pushPayload(player.socket, payload, state.limits);
    }
  }
}

/** Every player hears that the GM came or went. */
export function announceGm(state: TableState, online: boolean): void {
  toEveryPlayer(state, { v: 1, t: 'gm', online });
}
