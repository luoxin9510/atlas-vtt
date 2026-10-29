import { realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import type { RelayConfig } from './config.ts';
import { AssetStore, assetLimitsOf, SWEEP_INTERVAL_MS } from './assets/assetStore.ts';
import { createHandler } from './http.ts';
import { TableLinks } from './gmLink.ts';
import { createSocketServer } from './socket.ts';
import { TableRegistry } from './tables.ts';

export interface RunningRelay {
  /** Where the relay listens, e.g. `http://127.0.0.1:8787` (with the real port when 0 was asked for). */
  readonly origin: string;
  readonly tables: TableRegistry;
  readonly links: TableLinks;
  readonly assets: AssetStore;
  /** How many TCP connections the HTTP server holds open right now (for tests and diagnostics). */
  openConnections(): Promise<number>;
  close(): Promise<void>;
}

/** The folder's real path; a missing one keeps its plain absolute path (every request then answers 404). */
async function realRoot(dir: string): Promise<string> {
  const absolute = resolve(dir);
  return realpath(absolute).catch(() => absolute);
}

/** Starts the relay: HTTP and the table sockets. `log` gets one line per request (method, path without query, status). */
export async function startRelay(config: RelayConfig, log?: (line: string) => void): Promise<RunningRelay> {
  const tables = new TableRegistry({ statePath: config.statePath, maxPlayers: config.maxPlayers, unhostedTableMs: config.timing.unhostedTableMs, log });
  tables.ensureTicketKey();
  const assets = await AssetStore.open(config.assetDir ?? join(dirname(config.statePath), 'assets'), assetLimitsOf(config), Date.now);
  // No await between open and subscribe, and the purge runs after: a table that ended during the open (or before this start) is not missed.
  tables.subscribe({ replaced: () => undefined, ended: (code) => void assets.deleteTable(code).catch(() => undefined) });
  await assets.purgeUnknown((code) => tables.has(code)).catch((error: unknown) => {
    // The error's errno code or class only: its message may hold a path.
    const errno = (error as NodeJS.ErrnoException).code;
    log?.(`asset purge failed: ${typeof errno === 'string' ? errno : error instanceof Error ? error.name : 'error'}`);
  });
  const sweeper = setInterval(() => void assets.sweep().catch(() => undefined), SWEEP_INTERVAL_MS);
  sweeper.unref();
  // The real path, once: static.ts compares every resolved file against it (macOS /var is itself a link).
  const staticDir = config.staticDir === null ? null : await realRoot(config.staticDir);
  const handler = createHandler({ config: { ...config, staticDir }, tables, assets, log });
  const links = new TableLinks(tables, config.timing, config.maxBacklogBytes);
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
    clearInterval(sweeper);
    await tables.close();
    throw error;
  }
  const { port } = server.address() as AddressInfo;
  const hostName = config.host.includes(':') ? `[${config.host}]` : config.host;
  return {
    origin: `http://${hostName}:${port}`,
    tables,
    links,
    assets,
    openConnections: () => new Promise<number>((done, fail) => server.getConnections((error, count) => (error === null ? done(count) : fail(error)))),
    async close(): Promise<void> {
      clearInterval(sweeper);
      sockets.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      await tables.close();
    },
  };
}
