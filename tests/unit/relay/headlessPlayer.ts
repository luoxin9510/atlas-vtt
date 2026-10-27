import WebSocket from 'ws';
import { parseGmMessage, parseRelayFrame, PROTOCOL_VERSION, type GmMessage, type PlayerMessage } from '../../../src/app/online/protocol/index.ts';
import { TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

export interface HeadlessPlayer {
  readonly welcome: Promise<{ id: string; key: string }>;
  /** The GM messages received, parsed. */
  readonly messages: GmMessage[];
  send(body: PlayerMessage): void;
  /** The close code, once the socket closes. */
  readonly closed: Promise<number>;
  readonly socket: WebSocket;
}

/** A player page without a browser: it says hello on open, collects the GM's messages and nothing is reassembled (parts are Plan 2's). */
export function headlessPlayer(origin: string, code: string, hello: { name: string; code?: string; key?: string }): Promise<HeadlessPlayer> {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/api/tables/${code}/socket`, { headers: { origin: TEST_PUBLIC_ORIGIN } });
  const messages: GmMessage[] = [];
  let welcomed: (value: { id: string; key: string }) => void = () => undefined;
  let refused: (error: Error) => void = () => undefined;
  const welcome = new Promise<{ id: string; key: string }>((done, fail) => ((welcomed = done), (refused = fail)));
  // A test that never awaits the welcome is not failed by a refusal it did not ask about.
  welcome.catch(() => undefined);
  const closed = new Promise<number>((done) => socket.once('close', (closeCode) => (refused(new Error(`closed ${closeCode} before a welcome`)), done(closeCode))));
  socket.on('error', () => undefined);
  socket.on('message', (data) => {
    const text = String(data);
    if (text === 'pong') return;
    const frame = parseRelayFrame(text);
    if (frame === null) return;
    if (frame.t === 'welcome' && frame.role === 'player') welcomed({ id: frame.id, key: frame.key });
    else if (frame.t === 'game') {
      const message = parseGmMessage(frame.body);
      if (message !== null) messages.push(message);
    }
  });
  const player: HeadlessPlayer = {
    welcome,
    messages,
    closed,
    socket,
    send: (body) => socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'send', body })),
  };
  return new Promise((done, fail) => {
    socket.once('open', () => {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'hello', role: 'player', ...hello }));
      done(player);
    });
    socket.once('error', fail);
  });
}
