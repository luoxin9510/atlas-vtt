import { WebSocket } from 'ws';
import { ALL_PLAYERS, type BatchedSend, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { TableState } from './gmLink.ts';

/**
 * Backpressure: bytes the relay may hold in memory for one socket that is not reading. A player past
 * 8 MiB (about 25 asset chunks) is closed; a GM, who is the table's one trusted socket and receives
 * every player's frames, gets 32 MiB. Only the slow socket is dropped, nobody else waits for it.
 */
export const PLAYER_BUFFER_LIMIT = 8 * 1024 * 1024;
export const GM_BUFFER_LIMIT = 32 * 1024 * 1024;
/** "Try again later": not a final code, so a page reconnects and resyncs. */
export const CLOSE_OVERLOADED = 1013;
/** A closing socket that does not finish by then (its peer reads nothing) is terminated and its buffer freed. */
const OVERLOAD_TERMINATE_MS = 1000;

/** Sends `text` unless the socket is already over `limit`; then the socket is closed 1013 and cut off shortly after. */
export function push(socket: WebSocket, text: string, limit: number = PLAYER_BUFFER_LIMIT): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > limit) {
    socket.close(CLOSE_OVERLOADED);
    setTimeout(() => socket.terminate(), OVERLOAD_TERMINATE_MS).unref();
    return;
  }
  socket.send(text);
}

export function sendFrame(socket: WebSocket, frame: RelayFrame, limit: number = PLAYER_BUFFER_LIMIT): void {
  push(socket, JSON.stringify(frame), limit);
}

/** To the table's GM, if one is connected. */
export function toGm(state: TableState, frame: RelayFrame): void {
  if (state.gm !== null) sendFrame(state.gm, frame, GM_BUFFER_LIMIT);
}

/** To every connected player. */
export function toEveryPlayer(state: TableState, frame: RelayFrame): void {
  const text = JSON.stringify(frame);
  for (const player of state.players.values()) push(player.socket, text);
}

/** A game message from player `id`: it reaches the GM with `from` stamped; the body goes on as it came. */
export function gameFromPlayer(state: TableState, id: string, body: unknown): void {
  toGm(state, { v: 1, t: 'game', from: id, body });
}

/** GM messages: one player, or all (`ALL_PLAYERS`); an unknown player gets nothing. */
export function gameFromGm(state: TableState, sends: readonly BatchedSend[]): void {
  for (const { to, body } of sends) {
    const text = JSON.stringify({ v: 1, t: 'game', body });
    if (to === ALL_PLAYERS) for (const player of state.players.values()) push(player.socket, text);
    else {
      const player = state.players.get(to);
      if (player !== undefined) push(player.socket, text);
    }
  }
}

/** Every player hears that the GM came or went. */
export function announceGm(state: TableState, online: boolean): void {
  toEveryPlayer(state, { v: 1, t: 'gm', online });
}
