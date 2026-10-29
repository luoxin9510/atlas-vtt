import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PLAYER_ID_PATTERN } from '../../../../src/app/online/protocol/identity.ts';
import { isHash } from '../../../../src/app/online/protocol/asset.ts';
import { TABLE_CODE_PATTERN } from '../../../../src/app/online/protocol/relay.ts';
import type { RelayConfig } from '../config.ts';
import { bearerOf, readBody, refuseAndDrain, send } from '../httpUtil.ts';
import { clientAddress, MintRateLimit, UploadRateLimit } from '../limits.ts';
import type { TableRegistry } from '../tables.ts';
import type { AssetStore, PartResult } from './assetStore.ts';
import { mintTicket, TICKET_TTL_MS } from './tickets.ts';

const ROUTE = /^\/api\/tables\/([^/]+)\/assets\/([^/]+)(?:\/(complete|tickets)|\/parts\/(\d{1,3}))?$/;

const REASONS: Record<number, string> = { 400: 'bad-request', 401: 'unauthorized', 404: 'gone', 409: 'missing-parts', 413: 'too-large', 415: 'not-an-image', 422: 'hash-mismatch', 429: 'busy', 500: 'failed', 507: 'storage-full' };

export interface UploadRoutes {
  /** Whether this request is one of the table's image routes (so its body is streamed and kept alive). */
  matches(method: string, path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void>;
}

interface UploadContext {
  readonly config: RelayConfig;
  readonly tables: TableRegistry;
  readonly store: AssetStore;
}

/**
 * `PUT .../parts/{index}`, `POST .../complete`, `POST .../tickets` (mints a 120 s download ticket for a player) and `GET .../assets/{hash}` (resume status) of a table, each with the table secret as Bearer.
 * A refusal before the table secret has passed ends the connection (no unauthenticated body is read). Any later refusal before the body is read is answered first and the body then drained within a bound (`refuseAndDrain`), so a client still streaming sees the status.
 */
export function createUploadRoutes({ config, tables, store }: UploadContext): UploadRoutes {
  const rate = new UploadRateLimit();
  const mintRate = new MintRateLimit();

  function parse(method: string, path: string): { code: string; hash: string; part: number | null; complete: boolean; mint: boolean } | null {
    const match = ROUTE.exec(path);
    if (match === null) return null;
    const [, code = '', hash = '', complete, part] = match;
    if (!TABLE_CODE_PATTERN.test(code) || !isHash(hash)) return null;
    const wanted = complete !== undefined ? 'POST' : part !== undefined ? 'PUT' : 'GET';
    return method === wanted ? { code, hash, part: part === undefined ? null : Number(part), complete: complete === 'complete', mint: complete === 'tickets' } : null;
  }

  function refuse(req: IncomingMessage, res: ServerResponse, status: number): void {
    refuseAndDrain(req, res, status, { error: REASONS[status] ?? 'failed' });
  }

  /** A refusal before the caller has proven the table secret: answered and the connection ended, nothing of the body is read on. */
  function refuseClosing(res: ServerResponse, status: number): void {
    res.setHeader('connection', 'close');
    send(res, status, { error: REASONS[status] ?? 'failed' });
  }

  function answer(req: IncomingMessage, res: ServerResponse, result: PartResult, ok: unknown): void {
    if (result.status === 200) send(res, 200, ok);
    else refuse(req, res, result.status);
  }

  /**
   * Writes a part from a relay stream, so a failing write destroys that stream and not the request, which is then drained.
   * The stream has an error handler from the start (the store attaches its own only after some awaits, and an abort can come
   * before), and a refusal unpipes it so the request is not held back by a stream nobody reads.
   */
  async function writePart(req: IncomingMessage, code: string, hash: string, index: number): Promise<PartResult> {
    const relayed = new PassThrough();
    relayed.on('error', () => undefined);
    req.pipe(relayed);
    // A client that aborts ends the relayed stream, as it did when the request itself was written from.
    req.once('close', () => {
      if (!req.readableEnded) relayed.destroy(new Error('aborted'));
    });
    const result = await store.writePart(code, hash, index, relayed);
    if (result.status !== 200) {
      req.unpipe(relayed);
      relayed.destroy();
    }
    return result;
  }

  async function mint(req: IncomingMessage, res: ServerResponse, code: string, hash: string): Promise<void> {
    const text = await readBody(req, res);
    if (text === null) return;
    let player: unknown;
    try {
      const body: unknown = JSON.parse(text);
      player = typeof body === 'object' && body !== null ? (body as { player?: unknown }).player : undefined;
    } catch {
      player = undefined;
    }
    if (typeof player !== 'string' || !PLAYER_ID_PATTERN.test(player)) return refuse(req, res, 400);
    if (!store.has(code, hash)) return refuse(req, res, 404);
    const expires = Date.now() + TICKET_TTL_MS;
    send(res, 200, { url: `/api/assets/${hash}?t=${mintTicket(tables.ensureTicketKey(), code, player, hash, expires)}`, expires });
  }

  return {
    matches: (method, path) => parse(method, path) !== null,
    async handle(req, res, method, path): Promise<void> {
      const route = parse(method, path);
      if (route === null) return refuseClosing(res, 404);
      if (!(route.mint ? mintRate : rate).allow(clientAddress(req, config.trustProxy))) return refuseClosing(res, 429);
      if (!tables.checkSecret(route.code, bearerOf(req))) {
        return refuseClosing(res, 401);
      }
      if (route.part !== null) {
        return answer(req, res, await writePart(req, route.code, route.hash, route.part), {});
      }
      if (route.mint) return mint(req, res, route.code, route.hash);
      if (route.complete) return answer(req, res, await store.complete(route.code, route.hash), { hash: route.hash });
      send(res, 200, store.status(route.code, route.hash));
    },
  };
}
