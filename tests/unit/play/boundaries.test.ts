import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkBoundaries } from '../../../scripts/boundaries/graph.mjs';
import * as manifest from '../../../scripts/boundaries.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(playSource: string): string {
  const root = mkdtempSync(join(tmpdir(), 'atlas-play-boundary-'));
  roots.push(root);
  const files: Record<string, string> = {
    'src/app/online/gm/OnlineTable.ts': 'export const table = 1;',
    'src/app/i18n/index.ts': 'export function t(key: string): string { return key; }',
    'apps/play/src/bad.ts': playSource,
    // As in the repository: the root resolves like Node (no package `exports`), the player app like its bundler.
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Node', module: 'esnext', allowImportingTsExtensions: true } }),
    'apps/play/tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', module: 'esnext', allowImportingTsExtensions: true } }),
  };
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  symlinkSync(resolve(__dirname, '../../../node_modules'), join(root, 'node_modules'), 'dir');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  return root;
}

function violations(playSource: string): string[] {
  return checkBoundaries(fixture(playSource), { ...manifest, TYPE_PROJECTS: {} }).violations;
}

describe('play boundary group', { timeout: 30_000 }, () => {
  it('rejects an import of the plugin-only online code', () => {
    const found = violations("import '../../../src/app/online/gm/OnlineTable.ts';");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('apps/play/src/bad.ts');
  });

  it('accepts an import of a shared file', () => {
    expect(violations("import { t } from '../../../src/app/i18n/index.ts'; export const x = t('a');")).toEqual([]);
  });

  it('resolves a package entry point through its exports, as the bundler does', () => {
    expect(violations("import 'pixi.js/unsafe-eval';")).toEqual([]);
  });

  it('rejects a package outside the list', () => {
    expect(violations("import 'howler';")).toHaveLength(1);
  });
});
