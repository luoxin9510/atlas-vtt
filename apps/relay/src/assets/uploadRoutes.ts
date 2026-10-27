import type { IncomingMessage, ServerResponse } from 'node:http';
import { isHash } from '../../../../src/app/online/protocol/asset.ts';
import { TABLE_CODE_PATTERN } from '../../../../src/app/online/protocol/relay.ts';
import type { RelayConfig } from '../config.ts';
import { bearerOf, send } from '../httpUtil.ts';
import { clientAddress, UploadRateLimit } from '../limits.ts';
import type { TableRegistry } from '../tables.ts';
import type { AssetStore, PartResult } from './assetStore.ts';

const ROUTE = /^\/api\/tables\/([^/]+)\/assets\/([^/]+)(?:\/(complete)|\/parts\/(\d{1,3}))?$/;

const REASONS: Record<number, string> = { 400: 'bad-request', 404: 'gone', 409: 'missing-parts', 413: 'too-large', 415: 'not-an-image', 422: 'hash-mismatch', 429: 'busy', 500: 'failed', 507: 'storage-full' };

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
 * `PUT .../parts/{index}`, `POST .../complete` and `GET .../assets/{hash}` (resume status) of a table, each with the table secret as Bearer.
 * A refusal before the body is read closes the connection, so a client still streaming is cut off.
 */
export function createUploadRoutes({ config, tables, store }: UploadContext): UploadRoutes {
  const rate = new UploadRateLimit();

  function parse(method: string, path: string): { code: string; hash: string; part: number | null; complete: boolean } | null {
    const match = ROUTE.exec(path);
    if (match === null) return null;
    const [, code = '', hash = '', complete, part] = match;
    if (!TABLE_CODE_PATTERN.test(code) || !isHash(hash)) return null;
    const wanted = complete !== undefined ? 'POST' : part !== undefined ? 'PUT' : 'GET';
    return method === wanted ? { code, hash, part: part === undefined ? null : Number(part), complete: complete !== undefined } : null;
  }

  function refuse(res: ServerResponse, status: number): void {
    res.setHeader('connection', 'close');
    send(res, status, { error: REASONS[status] ?? 'failed' });
  }

  function answer(res: ServerResponse, result: PartResult, ok: unknown): void {
    if (result.status === 200) send(res, 200, ok);
    else refuse(res, result.status);
  }

  return {
    matches: (method, path) => parse(method, path) !== null,
    async handle(req, res, method, path): Promise<void> {
      const route = parse(method, path);
      if (route === null) return refuse(res, 404);
      if (!rate.allow(clientAddress(req, config.trustProxy))) return refuse(res, 429);
      if (!tables.checkSecret(route.code, bearerOf(req))) {
        res.setHeader('connection', 'close');
        return send(res, 401, { error: 'unauthorized' });
      }
      if (route.part !== null) {
        return answer(res, await store.writePart(route.code, route.hash, route.part, req), {});
      }
      if (route.complete) return answer(res, await store.complete(route.code, route.hash), { hash: route.hash });
      send(res, 200, store.status(route.code, route.hash));
    },
  };
}
