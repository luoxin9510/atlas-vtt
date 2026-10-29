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
/** How much of a refused request's body is read and thrown away, and for how long, before the request is destroyed. */
export const REFUSED_DRAIN_BYTES = 16 * 1024 * 1024;
export const REFUSED_DRAIN_MS = 10_000;

/**
 * Answers a request refused before its body was read, then reads and discards the rest of the body, so the kernel never
 * resets the connection with unread data waiting and the client can read the status. Past the byte or time bound the request
 * is destroyed. Drained data is never kept or logged; the timer is always cleared.
 */
export function refuseAndDrain(req: IncomingMessage, res: ServerResponse, status: number, body?: unknown): void {
  send(res, status, body);
  if (req.destroyed || req.readableEnded) return;
  let seen = 0;
  const stop = (): void => {
    clearTimeout(timer);
    req.off('data', onData);
    req.off('end', stop);
    req.off('close', stop);
    req.off('error', stop);
  };
  const giveUp = (): void => {
    stop();
    req.destroy();
  };
  const onData = (chunk: Buffer): void => {
    seen += chunk.length;
    if (seen > REFUSED_DRAIN_BYTES) giveUp();
  };
  const timer = setTimeout(giveUp, REFUSED_DRAIN_MS);
  timer.unref();
  req.on('data', onData);
  req.once('end', stop);
  req.once('close', stop);
  req.once('error', stop);
  req.resume();
}

/**
 * Reads at most 4 KiB of body. A body that is longer is answered 413 and one that fails 400; the rest of an oversize body is drained
 * (bounded, see `refuseAndDrain`) and the result is null. Never stored or logged.
 */
export function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const refuse = (status: number, error: string): void => {
      settled = true;
      chunks.length = 0;
      resolve(null);
      refuseAndDrain(req, res, status, { error });
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
