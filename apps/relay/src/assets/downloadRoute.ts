import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream';
import { isHash } from '../../../../src/app/online/protocol/asset.ts';
import { send } from '../httpUtil.ts';
import type { TableRegistry } from '../tables.ts';
import type { AssetStore } from './assetStore.ts';
import { readTicket } from './tickets.ts';

const ROUTE = /^\/api\/assets\/([^/?]+)$/;

/** Whether this is a download request (`GET /api/assets/{hash}`, query or not). */
export function isDownload(method: string, path: string): boolean {
  return method === 'GET' && ROUTE.test(path);
}

/** One answer for every failure, so nothing tells a bad ticket from an unknown image. */
function notFound(res: ServerResponse): void {
  send(res, 404, { error: 'not-found' });
}

/** `GET /api/assets/{hash}?t=<ticket>`: the image bytes for a valid, unexpired ticket of a table that holds the hash. */
export function serveDownload(req: IncomingMessage, res: ServerResponse, path: string, tables: TableRegistry, store: AssetStore): void {
  const hash = ROUTE.exec(path)?.[1] ?? '';
  const query = (req.url ?? '').split('?')[1] ?? '';
  const t = new URLSearchParams(query).get('t') ?? '';
  if (!isHash(hash) || t === '') return notFound(res);
  const ticket = readTicket(tables.ensureTicketKey(), t, hash, Date.now());
  if (ticket === null || !tables.has(ticket.code)) return notFound(res);
  const image = store.open(ticket.code, hash);
  if (image === null) return notFound(res);
  res.writeHead(200, {
    'content-type': image.mime,
    'content-length': image.size,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-origin',
  });
  pipeline(image.stream, res, () => undefined);
}
