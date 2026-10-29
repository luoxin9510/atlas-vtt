import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..', '..');
const PROTOCOL = ['asset.ts', 'identity.ts', 'level.ts', 'relay.ts', 'seat.ts', 'shape.ts'];
let work = '';
let out = '';
let files: string[] = [];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
}

function bundle(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync('node', [join(root, 'scripts', 'bundle-relay.mjs'), ...args], { cwd: root, encoding: 'utf8' });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'atlas-bundle-'));
  const dist = join(work, 'play-dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<h1>fake player</h1>');
  writeFileSync(join(dist, 'assets', 'x-abc123.js'), 'console.log(1)');
  out = join(work, 'bundle');
  const result = bundle(['--play-dist', dist, '--out', out]);
  if (result.status !== 0) throw new Error(`bundler failed: ${String(result.stderr)}`);
  files = walk(out).map((file) => relative(out, file).split('\\').join('/')).sort();
}, 120_000);

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('relay bundle', () => {
  it('holds the relay sources, exactly the protocol files they import, and the player build', () => {
    const relaySources = walk(join(root, 'apps', 'relay', 'src')).map((file) => relative(root, file).split('\\').join('/'));
    for (const source of relaySources) expect(files).toContain(source);
    const protocol = files.filter((file) => file.startsWith('src/')).sort();
    expect(protocol).toEqual(PROTOCOL.map((name) => `src/app/online/protocol/${name}`));
    expect(files).toContain('apps/relay/package.json');
    expect(files).toContain('apps/play/dist/index.html');
    expect(files).toContain('apps/play/dist/assets/x-abc123.js');
    expect(files.filter((file) => !file.startsWith('apps/') && !file.startsWith('src/')).sort()).toEqual(['VERSION', 'package-lock.json', 'package.json'].filter((file) => file !== 'package-lock.json' || files.includes(file)));
  });

  it('has a root package.json with ws pinned, a VERSION with the commit, and a tgz beside it', () => {
    expect(JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))).toEqual({ private: true, type: 'module', dependencies: { ws: '8.18.3' } });
    expect(readFileSync(join(out, 'VERSION'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(`${out}.tgz`)).toBe(true);
  });

  it('has a lockfile for ws (skipped when npm could not reach the registry)', (context) => {
    if (!files.includes('package-lock.json')) return context.skip();
    expect(readFileSync(join(out, 'package-lock.json'), 'utf8')).toContain('"node_modules/ws"');
  });

  it('fails loudly when an import leaves the relay and the protocol', () => {
    const stray = join(root, 'apps', 'relay', 'src', '__stray.ts');
    writeFileSync(stray, "import '../../../src/app/online/other.ts';\n");
    try {
      const result = bundle(['--play-dist', join(work, 'play-dist'), '--out', join(work, 'bad')]);
      expect(result.status).not.toBe(0);
      expect(String(result.stderr)).toContain('leaves apps/relay and src/app/online/protocol');
    } finally {
      rmSync(stray, { force: true });
    }
  }, 60_000);

  it('starts from the bundle and serves index.html at /', async () => {
    symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'));
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn('node', ['apps/relay/src/main.ts'], {
      cwd: out,
      env: { PATH: process.env.PATH ?? '', HOST_KEY: 'bundle-test-host-key-0123456789', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, PORT: String(port), HOST: '127.0.0.1', STATE_PATH: join(work, 'state.json'), STATIC_DIR: 'apps/play/dist' },
      stdio: 'ignore',
    });
    try {
      let body = '';
      for (let attempt = 0; attempt < 100 && body === ''; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
        if (response !== null) {
          expect(response.status).toBe(200);
          body = await response.text();
        } else await new Promise((done) => setTimeout(done, 100));
      }
      expect(body).toBe('<h1>fake player</h1>');
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
