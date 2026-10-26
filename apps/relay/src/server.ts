import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { RelayConfig } from './config.ts';
import { createHandler } from './http.ts';
import { TableLinks } from './gmLink.ts';
import { createSocketServer } from './socket.ts';
import { TableRegistry } from './tables.ts';

export interface RunningRelay {
  /** Where the relay listens, e.g. `http://127.0.0.1:8787` (with the real port when 0 was asked for). */
  readonly origin: string;
  readonly tables: TableRegistry;
  readonly links: TableLinks;
  close(): Promise<void>;
}

/** Starts the relay: HTTP and the table sockets. `log` gets one line per request (method, path without query, status). */
export async function startRelay(config: RelayConfig, log?: (line: string) => void): Promise<RunningRelay> {
  const tables = new TableRegistry({ statePath: config.statePath, maxPlayers: config.maxPlayers, unhostedTableMs: config.timing.unhostedTableMs });
  const staticDir = config.staticDir === null ? null : resolve(config.staticDir);
  const handler = createHandler({ config: { ...config, staticDir }, tables, log });
  const links = new TableLinks(tables, config.timing);
  const sockets = createSocketServer(tables, links, config, log);
  const server = createServer(handler);
  server.on('upgrade', (req, socket, head) => sockets.upgrade(req, socket, head));
  try {
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(config.port, config.host, () => {
        server.off('error', fail);
        done();
      });
    });
  } catch (error) {
    await tables.close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  const hostName = config.host.includes(':') ? `[${config.host}]` : config.host;
  return {
    origin: `http://${hostName}:${port}`,
    tables,
    links,
    async close(): Promise<void> {
      sockets.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      await tables.close();
    },
  };
}
