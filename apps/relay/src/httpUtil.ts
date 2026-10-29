import type { IncomingMessage, ServerResponse } from 'node:http';

/** Answers with a status and, when given, a JSON body (never cached). */
export function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

/** The token of an `Authorization: Bearer` header, or an empty text. */
export function bearerOf(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

export const MAX_BODY = 4 * 1024;

/**
 * Reads at most 4 KiB of body. A body that is longer is answered 413 and one that fails 400, both with `connection: close`, and
 * the result is null: the response is written first and `connection: close` ends the socket after it (input still arriving is dropped, never held), so the client can read it. Never stored or logged.
 */
export function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const refuse = (status: number, error: string): void => {
      settled = true;
      chunks.length = 0;
      res.setHeader('connection', 'close');
      send(res, status, { error });
      resolve(null);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (settled) return;
      if (size > MAX_BODY) refuse(413, 'too-large');
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!settled && !res.headersSent) refuse(400, 'bad-body');
    });
  });
}
