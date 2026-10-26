import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocketServer, type WebSocket } from 'ws';
import { CLOSE, isOtherVersion, KEEPALIVE_PING, KEEPALIVE_PONG, MAX_PLAYER_FRAME, parseClientFrame, TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { normalizeOrigin, type RelayConfig } from './config.ts';
import type { TableLinks } from './gmLink.ts';
import { clientAddress, SocketCap } from './limits.ts';
import type { TableRegistry } from './tables.ts';

/** Largest frame of a welcomed GM (a little over the protocol's 320 KiB chunk, with room for the envelope). */
const MAX_WELCOMED_FRAME = 512 * 1024;
/** A player or unwelcomed socket may send this many frames in any second; one more closes it 4005. */
const MAX_FRAMES_PER_SECOND = 20;
const SOCKET_PATH = /^\/api\/tables\/([^/]+)\/socket$/;

function bytesOf(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

function refuse(socket: Duplex, status: '404 Not Found' | '429 Too Many Requests'): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export interface SocketServer {
  /** Hand this the HTTP server's `upgrade` event. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
}

/**
 * The WebSocket side: `/api/tables/{code}/socket` for known tables only, at most 20 sockets per client
 * address. A socket starts unwelcomed (4 KiB frames, hello only, 10 s to say it); a GM hello with the
 * right secret makes it the table's GM, a player hello from the public origin makes it a player.
 * Frames are never logged, only close codes.
 */
export function createSocketServer(tables: TableRegistry, links: TableLinks, config: RelayConfig, log?: (line: string) => void): SocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WELCOMED_FRAME });
  const cap = new SocketCap();

  function handle(code: string, socket: WebSocket, req: IncomingMessage): void {
    const address = clientAddress(req, config.trustProxy);
    if (!tables.has(code)) return socket.close(CLOSE.ended);
    links.stateOf(code).sockets.add(socket);
    /** 'new': no accepted hello yet; 'player': welcomed or waiting. */
    let kind: 'new' | 'gm' | 'player' = 'new';
    /** Set once this relay closed the socket itself: later frames are ignored and no other close code may replace it. */
    let done = false;
    const end = (closeCode: number): void => {
      done = true;
      socket.close(closeCode);
    };
    const frameTimes: number[] = [];
    const helloTimer = setTimeout(() => {
      if (kind === 'new' && !done) end(CLOSE.protocol);
    }, config.timing.helloTimeoutMs);
    helloTimer.unref();

    const overRate = (): boolean => {
      const now = Date.now();
      while (frameTimes.length > 0 && now - (frameTimes[0] ?? now) >= 1000) frameTimes.shift();
      frameTimes.push(now);
      return frameTimes.length > MAX_FRAMES_PER_SECOND;
    };

    socket.on('message', (data, isBinary) => {
      if (done) return;
      const bytes = bytesOf(data);
      if (kind !== 'gm') {
        if (overRate()) return end(CLOSE.rateLimited);
        if (bytes.length > MAX_PLAYER_FRAME) return end(CLOSE.tooLarge);
      }
      if (isBinary) return;
      const text = bytes.toString('utf8');
      if (text === KEEPALIVE_PING) return socket.send(KEEPALIVE_PONG);
      if (kind === 'gm') {
        // A GM replaced by a newer one is closing; its late frames do not count.
        if (links.peek(code)?.gm !== socket) return;
        const frame = parseClientFrame(text);
        if (frame !== null && frame.t !== 'hello') links.gmFrame(code, frame);
        return;
      }
      if (kind === 'player') {
        const frame = parseClientFrame(text);
        if (frame?.t === 'send') links.playerSend(code, socket, frame.body);
        return;
      }
      if (isOtherVersion(text)) return end(CLOSE.version);
      const frame = parseClientFrame(text);
      if (frame === null || frame.t !== 'hello') return end(CLOSE.protocol);
      if (frame.role === 'gm') {
        if (!tables.checkSecret(code, frame.secret)) return end(CLOSE.badSecret);
        kind = 'gm';
        clearTimeout(helloTimer);
        links.acceptGm(code, socket);
        return;
      }
      // Only the public origin's page may be a player; the GM socket (Obsidian) has no such origin.
      if (normalizeOrigin(req.headers.origin ?? '') !== config.publicOrigin) return end(CLOSE.protocol);
      if (!links.playerHello(code, socket, frame, address)) {
        done = true;
        return;
      }
      kind = 'player';
      clearTimeout(helloTimer);
    });

    socket.on('close', (closeCode) => {
      clearTimeout(helloTimer);
      links.socketClosed(code, socket);
      log?.(`WS ${kind === 'new' ? 'socket' : kind} closed ${closeCode}`);
    });
    socket.on('error', () => socket.terminate());
  }

  return {
    upgrade(req, socket, head): void {
      // Node removes its own 'error' listener before it emits 'upgrade': a peer that resets the connection would crash the process.
      socket.on('error', () => socket.destroy());
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const code = SOCKET_PATH.exec(path)?.[1];
      if (code === undefined || !TABLE_CODE_PATTERN.test(code) || !tables.has(code)) return refuse(socket, '404 Not Found');
      const address = clientAddress(req, config.trustProxy);
      if (!cap.acquire(address)) return refuse(socket, '429 Too Many Requests');
      // The connection ends when its TCP socket does, whether or not the upgrade got through.
      socket.once('close', () => cap.release(address));
      wss.handleUpgrade(req, socket, head, (ws) => handle(code, ws, req));
    },
    close(): void {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
