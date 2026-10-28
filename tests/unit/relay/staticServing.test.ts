import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTestState, startTestRelay } from './relayHarness.ts';

const running: Array<{ close(): Promise<void> }> = [];
let base = '';
let root = '';

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'atlas-static-'));
  root = join(base, 'site');
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(join(root, 'api'));
  writeFileSync(join(root, 'index.html'), '<h1>player</h1>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'api', 'leak.txt'), 'static api file');
  writeFileSync(join(base, 'x'), 'outside the root');
  writeFileSync(join(base, 'site-secret.txt'), 'sibling with the root as prefix');
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((relay) => relay.close()));
  removeTestState();
  rmSync(base, { recursive: true, force: true });
});

/** A raw request, so the path reaches the relay exactly as written (fetch would normalise it). */
function get(origin: string, path: string, method = 'GET'): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const { port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: Number(port), path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function relay(): Promise<string> {
  const started = await startTestRelay({ staticDir: root });
  running.push(started);
  return started.origin;
}

describe('static player page', () => {
  it('serves / as index.html and a file below the root, with CSP and nosniff', async () => {
    const origin = await relay();
    const index = await get(origin, '/');
    expect(index.status).toBe(200);
    expect(index.body).toBe('<h1>player</h1>');
    expect(index.headers['content-security-policy']).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    expect(index.headers['x-content-type-options']).toBe('nosniff');
    const script = await get(origin, '/assets/app.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers HEAD without a body', async () => {
    const head = await get(await relay(), '/assets/app.js', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it.each(['/../x', '/%2e%2e/x', '/assets/..%2f..%2fx', '/..%2fx', '/assets/../../x', '/../site-secret.txt', '/%2e%2e%2fsite-secret.txt', '/a%00b', '/index.html%00.js'])('answers 404 for %s', async (path) => {
    const response = await get(await relay(), path);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('outside the root');
    expect(response.body).not.toContain('sibling');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404 for a directory', async () => {
    const origin = await relay();
    expect((await get(origin, '/assets')).status).toBe(404);
    expect((await get(origin, '/assets/')).status).toBe(404);
  });

  it('never serves /api/* from the folder', async () => {
    const origin = await relay();
    expect((await get(origin, '/api/leak.txt')).status).toBe(404);
    expect((await get(origin, '/api/leak.txt', 'HEAD')).status).toBe(404);
  });
});
