import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SOCKETS_PER_ADDRESS } from '../../../apps/relay/src/limits.ts';
import { TableLinks } from '../../../apps/relay/src/gmLink.ts';
import { createSocketServer, type SocketServer } from '../../../apps/relay/src/socket.ts';
import { TableRegistry } from '../../../apps/relay/src/tables.ts';
import type { RelayConfig } from '../../../apps/relay/src/config.ts';

const CODE = 'a'.repeat(26);
const UNKNOWN = 'b'.repeat(26);
const TIMING = { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 30_000, stallMs: 30_000 };
const directories: string[] = [];
let open: { server: SocketServer; tables: TableRegistry } | null = null;

afterEach(async () => {
  open?.server.close();
  await open?.tables.close();
  open = null;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A socket server wired as the relay wires it, with one table, and no HTTP server in front of it. */
async function wired(): Promise<SocketServer> {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-upgrade-'));
  directories.push(directory);
  const config: RelayConfig = { hostKey: 'test-host-key-0123456789abcdef', host: '127.0.0.1', port: 0, publicOrigin: 'https://play.example.test', maxPlayers: 8, statePath: join(directory, 'state.json'), staticDir: null, trustProxy: 'none', maxBacklogBytes: 96 * 1024 * 1024, timing: TIMING };
  const tables = new TableRegistry({ statePath: config.statePath, maxPlayers: config.maxPlayers, unhostedTableMs: config.timing.unhostedTableMs });
  tables.ensureTicketKey();
  tables.create(CODE);
  const server = createSocketServer(tables, new TableLinks(tables, config.timing), config);
  open = { server, tables };
  return server;
}

/** What Node hands to `upgrade`: a socket that has no 'error' listener, since Node removed its own first. */
function fakeSocket(written: string[] = []): Duplex & { setNoDelay(): void; setTimeout(): void } {
  const socket = new Duplex({ read: () => undefined, write: (chunk: Buffer, _encoding, done) => (written.push(String(chunk)), done()) });
  socket.removeAllListeners('error');
  return Object.assign(socket, { setNoDelay: () => undefined, setTimeout: () => undefined });
}

function request(code: string, address: string): IncomingMessage {
  const headers = { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' };
  return { url: `/api/tables/${code}/socket`, method: 'GET', headers, socket: { remoteAddress: address } } as unknown as IncomingMessage;
}

describe('a peer that resets while the relay refuses its upgrade', () => {
  it('does not throw for an unknown table, and the socket is destroyed after the refusal is written', async () => {
    const server = await wired();
    const written: string[] = [];
    const socket = fakeSocket(written);
    server.upgrade(request(UNKNOWN, '203.0.113.1'), socket, Buffer.alloc(0));
    expect(() => socket.emit('error', new Error('ECONNRESET'))).not.toThrow();
    await vi.waitFor(() => expect(socket.destroyed).toBe(true));
    expect(written.join('')).toContain('404 Not Found');
  });

  it('does not throw for the 21st socket of one address, and the socket is destroyed after the refusal is written', async () => {
    const server = await wired();
    for (let i = 0; i < MAX_SOCKETS_PER_ADDRESS; i++) server.upgrade(request(CODE, '203.0.113.2'), fakeSocket(), Buffer.alloc(0));
    const written: string[] = [];
    const refused = fakeSocket(written);
    server.upgrade(request(CODE, '203.0.113.2'), refused, Buffer.alloc(0));
    expect(() => refused.emit('error', new Error('ECONNRESET'))).not.toThrow();
    await vi.waitFor(() => expect(refused.destroyed).toBe(true));
    expect(written.join('')).toContain('429 Too Many Requests');
  });
});
