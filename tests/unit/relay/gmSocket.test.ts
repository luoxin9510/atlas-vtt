import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { removeTestState, startTestRelay, TEST_HOST_KEY, TEST_PUBLIC_ORIGIN } from './relayHarness.ts';

const CODE = 'a'.repeat(26);
const running: Array<{ close(): Promise<void> }> = [];
const sockets: WebSocket[] = [];

async function start(...args: Parameters<typeof startTestRelay>): ReturnType<typeof startTestRelay> {
  const relay = await startTestRelay(...args);
  running.push(relay);
  return relay;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  vi.restoreAllMocks();
});

async function createTable(origin: string, code: string = CODE): Promise<string> {
  const response = await fetch(`${origin}/api/tables`, { method: 'POST', headers: { authorization: `Bearer ${TEST_HOST_KEY}`, origin: TEST_PUBLIC_ORIGIN }, body: JSON.stringify({ code }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { secret: string }).secret;
}

/** A client socket with its frames and its close code collected. */
class Client {
  readonly socket: WebSocket;
  readonly frames: string[] = [];
  readonly closed: Promise<number>;
  readonly opened: Promise<void>;

  constructor(origin: string, code: string = CODE) {
    this.socket = new WebSocket(`${origin.replace('http', 'ws')}/api/tables/${code}/socket`);
    sockets.push(this.socket);
    this.socket.on('message', (data) => this.frames.push(String(data)));
    this.opened = new Promise((done) => this.socket.once('open', () => done()));
    this.closed = new Promise((done) => this.socket.once('close', (closeCode) => done(closeCode)));
    this.socket.on('error', () => undefined);
  }

  async hello(secret: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.opened;
    this.socket.send(JSON.stringify({ v: 1, t: 'hello', role: 'gm', secret, level: 7, ...extra }));
  }

  async frame(index: number): Promise<unknown> {
    await vi.waitFor(() => expect(this.frames.length).toBeGreaterThan(index));
    return JSON.parse(this.frames[index] ?? 'null');
  }
}

async function welcomed(origin: string, secret: string): Promise<Client> {
  const client = new Client(origin);
  await client.hello(secret);
  await client.frame(0);
  return client;
}

describe('GM socket', () => {
  it('welcomes a GM with the right secret: role gm, no players, batch', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.hello(secret);
    expect(await client.frame(0)).toEqual({ v: 1, t: 'welcome', role: 'gm', players: [], batch: true });
  });

  it('closes 4001 for a wrong secret', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.hello('x'.repeat(43));
    expect(await client.closed).toBe(CLOSE.badSecret);
  });

  it('closes 4007 for another protocol version', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.opened;
    client.socket.send(JSON.stringify({ v: 2, t: 'hello', role: 'gm', secret }));
    expect(await client.closed).toBe(CLOSE.version);
  });

  it('closes 4006 for a first frame that is not a hello', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.opened;
    client.socket.send(JSON.stringify({ v: 1, t: 'end' }));
    expect(await client.closed).toBe(CLOSE.protocol);
  });

  it('answers a bare ping with pong, before and after the welcome', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.opened;
    client.socket.send('ping');
    await vi.waitFor(() => expect(client.frames).toEqual(['pong']));
    await client.hello(secret);
    await client.frame(1);
    client.socket.send('ping');
    await vi.waitFor(() => expect(client.frames.at(-1)).toBe('pong'));
  });

  it('closes 4004 for a first frame over 4 KiB', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.opened;
    client.socket.send('x'.repeat(5 * 1024));
    expect(await client.closed).toBe(CLOSE.tooLarge);
  });

  it('accepts a 300 KiB send after the welcome', async () => {
    const relay = await start();
    const client = await welcomed(relay.origin, await createTable(relay.origin));
    client.socket.send(JSON.stringify({ v: 1, t: 'send', to: '*', body: 'y'.repeat(300 * 1024) }));
    client.socket.send('ping');
    await vi.waitFor(() => expect(client.frames.at(-1)).toBe('pong'));
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('closes the first GM with 4002 when a second hello is accepted', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const first = await welcomed(relay.origin, secret);
    const second = await welcomed(relay.origin, secret);
    expect(await first.closed).toBe(CLOSE.replaced);
    expect(second.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('closes the connected GM with 4002 when the code is posted again', async () => {
    const relay = await start();
    const client = await welcomed(relay.origin, await createTable(relay.origin));
    const fresh = await createTable(relay.origin);
    expect(await client.closed).toBe(CLOSE.replaced);
    const again = await welcomed(relay.origin, fresh);
    expect(again.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('reports hosting: true on an accepted hello, false when that socket closes', async () => {
    const relay = await start();
    const hosted = vi.spyOn(relay.tables, 'setHosted');
    const client = await welcomed(relay.origin, await createTable(relay.origin));
    expect(hosted).toHaveBeenCalledWith(CODE, true);
    client.socket.close();
    await client.closed;
    await vi.waitFor(() => expect(hosted).toHaveBeenLastCalledWith(CODE, false));
  });

  it('does not report a wrong-secret socket as hosting', async () => {
    const relay = await start();
    const hosted = vi.spyOn(relay.tables, 'setHosted');
    await createTable(relay.origin);
    const client = new Client(relay.origin);
    await client.hello('x'.repeat(43));
    await client.closed;
    expect(hosted).not.toHaveBeenCalled();
  });

  it('a replaced GM closing does not unhost the table its successor holds', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const first = await welcomed(relay.origin, secret);
    const hosted = vi.spyOn(relay.tables, 'setHosted');
    await welcomed(relay.origin, secret);
    await first.closed;
    expect(hosted).not.toHaveBeenCalledWith(CODE, false);
  });

  it('end closes every socket of the table with 4008 and deletes it, so a later POST makes a fresh table', async () => {
    const relay = await start();
    const secret = await createTable(relay.origin);
    const gm = await welcomed(relay.origin, secret);
    const bystander = new Client(relay.origin);
    await bystander.opened;
    gm.socket.send(JSON.stringify({ v: 1, t: 'end' }));
    expect(await gm.closed).toBe(CLOSE.ended);
    expect(await bystander.closed).toBe(CLOSE.ended);
    expect(relay.tables.has(CODE)).toBe(false);
    const fresh = await createTable(relay.origin);
    expect(fresh).not.toBe(secret);
    const again = new Client(relay.origin);
    await again.hello(secret);
    expect(await again.closed).toBe(CLOSE.badSecret);
    await welcomed(relay.origin, fresh);
  });

  it('welcomes a GM after a restart with the saved secret', async () => {
    const first = await start();
    const secret = await createTable(first.origin);
    await first.close();
    running.splice(running.indexOf(first), 1);
    const second = await start({ statePath: first.config.statePath });
    const client = new Client(second.origin);
    await client.hello(secret);
    expect(await client.frame(0)).toMatchObject({ t: 'welcome', role: 'gm' });
  });

  it('answers 404 to an upgrade for an unknown table or another path', async () => {
    const relay = await start();
    await createTable(relay.origin);
    const statuses: number[] = [];
    for (const path of [`/api/tables/${'b'.repeat(26)}/socket`, '/api/tables/short/socket', `/api/tables/${CODE}/other`, '/socket']) {
      const socket = new WebSocket(`${relay.origin.replace('http', 'ws')}${path}`);
      sockets.push(socket);
      statuses.push(await new Promise<number>((done) => {
        socket.on('unexpected-response', (_req, res) => done(res.statusCode ?? 0));
        socket.on('error', () => undefined);
      }));
    }
    expect(statuses).toEqual([404, 404, 404, 404]);
  });
});
