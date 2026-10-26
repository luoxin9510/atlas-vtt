import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocketServer, type WebSocket } from 'ws';
import { CLOSE, isOtherVersion, KEEPALIVE_PING, KEEPALIVE_PONG, parseClientFrame, TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import type { TableLinks } from './gmLink.ts';
import type { TableRegistry } from './tables.ts';

/** Largest frame of a socket that has not said an accepted hello. */
const MAX_UNWELCOMED_FRAME = 4 * 1024;
/** Largest frame of a welcomed GM (a little over the protocol's 320 KiB chunk, with room for the envelope). */
const MAX_WELCOMED_FRAME = 512 * 1024;
const SOCKET_PATH = /^\/api\/tables\/([^/]+)\/socket$/;

function bytesOf(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

function refuse(socket: Duplex): void {
  socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

export interface SocketServer {
  /** Hand this the HTTP server's `upgrade` event. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
}

/**
 * The WebSocket side: `/api/tables/{code}/socket` for known tables only. A socket starts unwelcomed
 * (4 KiB frames, hello only); a GM hello with the right secret makes it the table's GM.
 * Frames are never logged, only close codes.
 */
export function createSocketServer(tables: TableRegistry, links: TableLinks, log?: (line: string) => void): SocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WELCOMED_FRAME });

  function handle(code: string, socket: WebSocket): void {
    const state = links.stateOf(code);
    state.sockets.add(socket);
    let welcomedGm = false;

    socket.on('message', (data, isBinary) => {
      const bytes = bytesOf(data);
      if (!welcomedGm && bytes.length > MAX_UNWELCOMED_FRAME) return socket.close(CLOSE.tooLarge);
      if (isBinary) return;
      const text = bytes.toString('utf8');
      if (text === KEEPALIVE_PING) return socket.send(KEEPALIVE_PONG);
      if (welcomedGm) {
        // A GM replaced by a newer one is closing; its late frames do not count.
        if (links.stateOf(code).gm !== socket) return;
        const frame = parseClientFrame(text);
        if (frame !== null && frame.t !== 'hello') links.gmFrame(code, frame);
        return;
      }
      if (isOtherVersion(text)) return socket.close(CLOSE.version);
      const frame = parseClientFrame(text);
      if (frame === null || frame.t !== 'hello') return socket.close(CLOSE.protocol);
      // Players (role 'player') join through the same hello in Task 7; until then they are refused.
      if (frame.role !== 'gm') return socket.close(CLOSE.protocol);
      if (!tables.checkSecret(code, frame.secret)) return socket.close(CLOSE.badSecret);
      welcomedGm = true;
      links.acceptGm(code, socket);
    });

    socket.on('close', (closeCode) => {
      links.socketClosed(code, socket);
      log?.(`WS ${welcomedGm ? 'gm' : 'socket'} closed ${closeCode}`);
    });
    socket.on('error', () => socket.terminate());
  }

  return {
    upgrade(req, socket, head): void {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const code = SOCKET_PATH.exec(path)?.[1];
      if (code === undefined || !TABLE_CODE_PATTERN.test(code) || !tables.has(code)) return refuse(socket);
      wss.handleUpgrade(req, socket, head, (ws) => handle(code, ws));
    },
    close(): void {
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
