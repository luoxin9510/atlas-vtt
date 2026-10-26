import type { WebSocket } from 'ws';
import { ALL_PLAYERS, type BatchedSend, type RelayFrame } from '../../../src/app/online/protocol/relay.ts';
import type { TableState } from './gmLink.ts';

export function sendFrame(socket: WebSocket, frame: RelayFrame): void {
  socket.send(JSON.stringify(frame));
}

/** To the table's GM, if one is connected. */
export function toGm(state: TableState, frame: RelayFrame): void {
  if (state.gm !== null) sendFrame(state.gm, frame);
}

/** To every connected player. */
export function toEveryPlayer(state: TableState, frame: RelayFrame): void {
  const text = JSON.stringify(frame);
  for (const player of state.players.values()) player.socket.send(text);
}

/** A game message from player `id`: it reaches the GM with `from` stamped; the body goes on as it came. */
export function gameFromPlayer(state: TableState, id: string, body: unknown): void {
  toGm(state, { v: 1, t: 'game', from: id, body });
}

/** GM messages: one player, or all (`ALL_PLAYERS`); an unknown player gets nothing. */
export function gameFromGm(state: TableState, sends: readonly BatchedSend[]): void {
  for (const { to, body } of sends) {
    const text = JSON.stringify({ v: 1, t: 'game', body });
    if (to === ALL_PLAYERS) for (const player of state.players.values()) player.socket.send(text);
    else state.players.get(to)?.socket.send(text);
  }
}

/** Every player hears that the GM came or went. */
export function announceGm(state: TableState, online: boolean): void {
  toEveryPlayer(state, { v: 1, t: 'gm', online });
}
