import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
};

/** Vite names files under `assets/` by content hash, so they never change; everything else (index.html first) is checked again each time. */
function cacheControl(relative: string): string {
  return /^[\\/]assets[\\/]/.test(relative) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, SECURITY_HEADERS).end();
}

/** Serves a file below `root`, which must already be a real path (`/` is index.html). Dotfiles, links that resolve outside `root`, other paths that leave it and directories answer 404. */
export async function serveStatic(root: string, urlPath: string, method: string, res: ServerResponse): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return notFound(res);
  }
  if (decoded.includes('\0')) return notFound(res);
  const relative = normalize(decoded === '/' ? '/index.html' : decoded);
  const file = join(root, relative);
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) return notFound(res);
  if (relative.split(/[\\/]/).some((part) => part.startsWith('.'))) return notFound(res);
  // One realpath per request: a link (file or directory) may only lead to somewhere still inside the root.
  const real = await realpath(file).catch(() => null);
  if (real === null || !real.startsWith(root.endsWith(sep) ? root : root + sep)) return notFound(res);
  // A link with a plain name may still lead to a dotfile or a dot-directory inside the root.
  if (real.slice(root.length).split(sep).some((part) => part.startsWith('.'))) return notFound(res);
  const info = await stat(real).catch(() => null);
  if (info === null || !info.isFile()) return notFound(res);
  res.writeHead(200, { ...SECURITY_HEADERS, 'cache-control': cacheControl(relative), 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': info.size });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  // pipeline destroys the file stream when the client goes away, so the descriptor is freed at once.
  pipeline(createReadStream(real), res, () => undefined);
}
