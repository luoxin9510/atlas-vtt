import type { Socket } from 'node:net';
import { expect, vi } from 'vitest';
import WebSocket from 'ws';
import { TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

export const CODE = 'a'.repeat(26);

export async function createTable(origin: string, code: string = CODE): Promise<string> {
  const response = await fetch(`${origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN }, body: JSON.stringify({ code }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

export interface Seen {
  readonly t: string;
  readonly [key: string]: unknown;
}

/** A client socket with its frames and its close code collected. */
export class Client {
  readonly socket: WebSocket;
  readonly frames: Seen[] = [];
  readonly closed: Promise<number>;
  readonly opened: Promise<void>;
  #pongs = 0;

  constructor(origin: string, sockets: WebSocket[], headers: Record<string, string> = {}, code: string = CODE) {
    this.socket = new WebSocket(`${origin.replace('http', 'ws')}/api/tables/${code}/socket`, { headers });
    sockets.push(this.socket);
    this.socket.on('message', (data) => {
      const text = String(data);
      if (text === 'pong') this.#pongs += 1;
      else this.frames.push(JSON.parse(text) as Seen);
    });
    this.opened = new Promise((done) => this.socket.once('open', () => done()));
    this.closed = new Promise((done) => this.socket.once('close', (closeCode) => done(closeCode)));
    this.socket.on('error', () => undefined);
  }

  async send(frame: unknown): Promise<void> {
    await this.opened;
    this.socket.send(JSON.stringify({ v: 1, ...(frame as object) }));
  }

  /** The first frame of type `t` (waits for it). */
  async frameOf(t: string, nth = 0): Promise<Seen> {
    await vi.waitFor(() => expect(this.frames.filter((frame) => frame.t === t).length).toBeGreaterThan(nth));
    return this.frames.filter((frame) => frame.t === t)[nth] as Seen;
  }

  types(): string[] {
    return this.frames.map((frame) => frame.t);
  }

  /**
   * A positive sync point: sends a ping on this socket and waits for its pong. The relay handles one socket's
   * frames in order, so everything this client sent before has been handled (and everything the relay
   * sent to it before the pong has arrived) when this returns.
   */
  async sync(): Promise<void> {
    await this.opened;
    const before = this.#pongs;
    this.socket.send('ping');
    await vi.waitFor(() => expect(this.#pongs).toBeGreaterThan(before));
  }

  /** Reads again after `deaf()`. */
  hear(): void {
    (this.socket as unknown as { _socket: Socket })._socket.resume();
  }

  /** Stops the client reading, so it never sees a close frame and can go on sending. */
  deaf(): void {
    (this.socket as unknown as { _socket: Socket })._socket.pause();
  }
}

export async function gmOf(origin: string, sockets: WebSocket[], secret: string): Promise<Client> {
  const gm = new Client(origin, sockets);
  await gm.send({ t: 'hello', role: 'gm', secret, level: 7 });
  await gm.frameOf('welcome');
  // As the real GM does on every welcome: an open gate, so the relay knows it.
  await gm.send({ t: 'gate', code: null, ask: false });
  return gm;
}

export function playerOf(origin: string, sockets: WebSocket[], hello: Record<string, unknown> = {}, headers: Record<string, string> = { origin: TEST_PUBLIC_ORIGIN }): Client {
  const player = new Client(origin, sockets, headers);
  void player.send({ t: 'hello', role: 'player', name: 'Ann', ...hello });
  return player;
}

/** A player who passed an open gate and holds a welcome. */
export async function joined(origin: string, sockets: WebSocket[], name = 'Ann'): Promise<{ player: Client; id: string; key: string }> {
  const player = playerOf(origin, sockets, { name });
  const welcome = await player.frameOf('welcome');
  return { player, id: welcome.id as string, key: welcome.key as string };
}
