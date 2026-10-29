import type { IncomingMessage, ServerResponse } from 'node:http';
import { SECRET_PATTERN, TABLE_CODE_PATTERN } from '../../../src/app/online/protocol/relay.ts';
import { normalizeOrigin, type RelayConfig } from './config.ts';
import { clientAddress, HostKeyLock, sameText, MeRateLimit, TableRateLimit } from './limits.ts';
import type { TableRegistry } from './tables.ts';
import { serveStatic } from './static.ts';
import { bearerOf, MAX_BODY, readBody, send } from './httpUtil.ts';
import type { AssetStore } from './assets/assetStore.ts';
import { isDownload, serveDownload } from './assets/downloadRoute.ts';
import { createUploadRoutes } from './assets/uploadRoutes.ts';

export interface HttpContext {
  readonly config: RelayConfig;
  readonly tables: TableRegistry;
  /** The image store; without one the asset routes do not exist. */
  readonly assets?: AssetStore;
  readonly log?: (line: string) => void;
}

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

function codeIn(text: string | null): string | null {
  if (text === null) return null;
  try {
    const body: unknown = JSON.parse(text);
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    return typeof code === 'string' && TABLE_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * The request's Origin must be the public origin. A request without an Origin header is allowed:
 * Obsidian's requestUrl sends none, and the Bearer host key is what authenticates it.
 */
function originAllowed(req: IncomingMessage, config: RelayConfig): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return typeof origin === 'string' && normalizeOrigin(origin) === config.publicOrigin;
}

export function createHandler(context: HttpContext): RequestHandler {
  const { config, tables } = context;
  const lock = new HostKeyLock();
  const rate = new TableRateLimit();
  const meRate = new MeRateLimit();
  const uploads = context.assets === undefined ? null : createUploadRoutes({ config, tables, store: context.assets });

  /** The one host-key check for every endpoint: 429 while the address is locked, a wrong key counts toward the lock. */
  function authorize(req: IncomingMessage, res: ServerResponse, address: string): boolean {
    if (lock.isLocked(address)) {
      send(res, 429, { error: 'locked' });
      return false;
    }
    if (!sameText(bearerOf(req), config.hostKey)) {
      lock.failed(address);
      send(res, 401, { error: 'unauthorized' });
      return false;
    }
    lock.succeeded(address);
    return true;
  }

  async function createTable(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Whatever the answer is, a refusal ends the connection: a body still being streamed is not read on.
    res.setHeader('connection', 'close');
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return send(res, 413, { error: 'too-large' });
    if (!originAllowed(req, config)) return send(res, 403, { error: 'origin' });
    const address = clientAddress(req, config.trustProxy);
    if (!lock.isLocked(address) && !rate.allow(address)) return send(res, 429, { error: 'rate-limited' });
    if (!authorize(req, res, address)) return;
    const text = await readBody(req, res);
    if (text === null) return;
    const code = codeIn(text);
    if (code === null) return send(res, 400, { error: 'bad-code' });
    let table: Awaited<ReturnType<TableRegistry['createDurable']>>;
    try {
      table = await tables.createDurable(code);
    } catch {
      return send(res, 503, { error: 'not-saved' });
    }
    if (table === 'full') return send(res, 429, { error: 'too-many-tables' });
    if (!SECRET_PATTERN.test(table.secret)) return send(res, 500);
    res.removeHeader('connection');
    send(res, 201, table);
  }

  function me(req: IncomingMessage, res: ServerResponse): void {
    const address = clientAddress(req, config.trustProxy);
    if (!lock.isLocked(address) && !meRate.allow(address)) return send(res, 429, { error: 'rate-limited' });
    if (!authorize(req, res, address)) return;
    send(res, 200, { account: { id: 'host', handle: 'host', name: 'Host' }, access: { plan: 'host', maxPlayers: config.maxPlayers } });
  }

  async function route(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
    if (method === 'POST' && path === '/api/tables') return createTable(req, res);
    if (uploads !== null && uploads.matches(method, path)) return uploads.handle(req, res, method, path);
    if (context.assets !== undefined && isDownload(method, path)) return serveDownload(req, res, path, tables, context.assets);
    if (method === 'GET' && path === '/api/me') return me(req, res);
    if (method === 'POST' && (path === '/api/feedback' || path === '/api/reports')) return send(res, 204);
    if ((method === 'GET' || method === 'HEAD') && config.staticDir !== null && !path.startsWith('/api/')) return serveStatic(config.staticDir, path, method, res);
    send(res, 404);
  }

  return (req, res) => {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    res.on('finish', () => context.log?.(`${method} ${path} ${res.statusCode}`));
    // Only POST /api/tables reads a body (4 KiB at most), and the image routes stream theirs (they close the connection themselves when they
    // refuse). Every other answer to a request that may carry one closes the connection, so whatever a client goes on streaming (the
    // unauthenticated sinks, a refusal, a 404) is cut off instead of drained.
    const streams = uploads?.matches(method, path) === true;
    if (method !== 'GET' && method !== 'HEAD' && !(method === 'POST' && path === '/api/tables') && !streams) res.setHeader('connection', 'close');
    route(req, res, method, path).catch(() => {
      if (!res.headersSent) send(res, 500);
      else res.end();
    });
  };
}
