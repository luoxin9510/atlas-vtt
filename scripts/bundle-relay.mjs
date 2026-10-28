// Builds the deployable relay bundle: dist/relay-bundle/ and dist/relay-bundle.tgz.
//   node scripts/bundle-relay.mjs [--play-dist <dir>] [--out <dir>]
// Without --play-dist it runs `npm run build:play` and copies apps/play/dist. The tgz is written beside --out (`<out>.tgz`).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELAY_SRC = join(root, 'apps', 'relay', 'src');
const PROTOCOL = join(root, 'src', 'app', 'online', 'protocol');
const IMPORT = /(?:\bimport|\bexport)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function argument(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function within(file, directory) {
  return file === directory || file.startsWith(directory + sep);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
}

/** Every source file the relay needs: apps/relay/src/** plus the protocol files reached through relative imports. Throws on any other file. */
export function relayFiles() {
  const files = new Set(walk(RELAY_SRC));
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!/\.(ts|mts|js|mjs)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      if (!within(target, join(root, 'apps', 'relay')) && !within(target, PROTOCOL)) {
        throw new Error(`${relative(root, file)} imports ${specifier}, which leaves apps/relay and src/app/online/protocol`);
      }
      if (!existsSync(target)) throw new Error(`${relative(root, file)} imports ${specifier}, which does not exist`);
      if (!files.has(target)) {
        files.add(target);
        queue.push(target);
      }
    }
  }
  return [...files].sort();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`);
}

function main() {
  const out = resolve(argument('--out') ?? join(root, 'dist', 'relay-bundle'));
  let playDist = argument('--play-dist');
  if (playDist === null) {
    run('npm', ['run', 'build:play'], { cwd: root });
    playDist = join(root, 'apps', 'play', 'dist');
  }
  playDist = resolve(playDist);
  if (!existsSync(join(playDist, 'index.html'))) throw new Error(`${playDist} has no index.html`);

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (commit.status !== 0) throw new Error('git rev-parse HEAD failed');

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of relayFiles()) {
    const target = join(out, relative(root, file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  cpSync(join(root, 'apps', 'relay', 'package.json'), join(out, 'apps', 'relay', 'package.json'));
  cpSync(playDist, join(out, 'apps', 'play', 'dist'), { recursive: true });
  writeFileSync(join(out, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { ws: '8.18.3' } }, null, 2) + '\n');
  writeFileSync(join(out, 'VERSION'), commit.stdout.trim() + '\n');
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: out });

  const tgz = `${out}.tgz`;
  rmSync(tgz, { force: true });
  run('tar', ['-czf', tgz, '-C', out, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const files = walk(out).map((file) => relative(out, file)).sort();
  console.log(files.join('\n'));
  console.log(`\n${files.length} files, ${(statSync(tgz).size / 1024 / 1024).toFixed(2)} MiB: ${tgz}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
