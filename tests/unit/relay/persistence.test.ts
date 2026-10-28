import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadState, saveState } from '../../../apps/relay/src/persist.ts';
import { TableRegistry } from '../../../apps/relay/src/tables.ts';

const calls: string[] = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      calls.push('open');
      const datasync = handle.datasync.bind(handle);
      handle.datasync = async () => {
        calls.push('datasync');
        return datasync();
      };
      return handle;
    },
    rename: async (...args: Parameters<typeof real.rename>) => {
      calls.push('rename');
      return real.rename(...args);
    },
  };
});

const directories: string[] = [];
const registries: TableRegistry[] = [];
const CODE = 'a'.repeat(26);

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'atlas-persist-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.close().catch(() => undefined);
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
  calls.length = 0;
});

function registryAt(statePath: string, extra: { unhostedTableMs?: number; log?: (line: string) => void } = {}): TableRegistry {
  const registry = new TableRegistry({ statePath, maxPlayers: 8, unhostedTableMs: extra.unhostedTableMs ?? 60_000, log: extra.log });
  registries.push(registry);
  return registry;
}

describe('durable state file (M5)', () => {
  it('syncs the temporary file to disk before it is renamed over the state file', async () => {
    const statePath = join(directory(), 'state.json');
    await saveState(statePath, { tables: { [CODE]: { secretHash: 'a'.repeat(64), lastHostedAt: 1 } }, ticketKey: null });
    expect(calls.indexOf('datasync')).toBeGreaterThan(calls.indexOf('open'));
    expect(calls.indexOf('rename')).toBeGreaterThan(calls.indexOf('datasync'));
    expect(JSON.parse(readFileSync(statePath, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('names the state file in the error for one that is not valid JSON', () => {
    const statePath = join(directory(), 'state.json');
    writeFileSync(statePath, '{"tables": ');
    expect(() => loadState(statePath)).toThrow(statePath);
  });
});

describe('write failures (M5)', () => {
  it('logs the first failed write of a streak once, without a secret, and again after a success', async () => {
    const root = directory();
    const statePath = join(root, 'missing', 'state.json');
    const lines: string[] = [];
    const registry = registryAt(statePath, { log: (line) => lines.push(line) });
    const created = registry.create(CODE);
    if (created === 'full') throw new Error('full');
    await expect(registry.flush()).rejects.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/state/i);
    expect(lines[0]).not.toContain(created.secret);
    registry.create(CODE);
    await expect(registry.flush()).rejects.toThrow();
    expect(lines).toHaveLength(1);
    // The directory appears: the write works, and a later failure is news again.
    const { mkdirSync, rmSync: remove } = await import('node:fs');
    mkdirSync(join(root, 'missing'));
    registry.create(CODE);
    await registry.flush();
    remove(join(root, 'missing'), { recursive: true, force: true });
    registry.create(CODE);
    await expect(registry.flush()).rejects.toThrow();
    expect(lines).toHaveLength(2);
  });
});

describe('hosted tables stay fresh (M3)', () => {
  it('refreshes lastHostedAt on disk while a GM hosts the table', async () => {
    const statePath = join(directory(), 'state.json');
    const registry = registryAt(statePath, { unhostedTableMs: 400 });
    registry.create(CODE);
    registry.setHosted(CODE, true);
    const startedAt = Date.now();
    await new Promise((done) => setTimeout(done, 1000));
    await registry.flush();
    const stored = loadState(statePath).tables[CODE];
    expect(stored?.lastHostedAt ?? 0).toBeGreaterThan(startedAt + 400);
    expect(registry.has(CODE)).toBe(true);
  });
});

describe('ticket key (M4)', () => {
  it('is made once, saved, and read back after a restart', async () => {
    const statePath = join(directory(), 'state.json');
    const first = registryAt(statePath);
    const key = first.ensureTicketKey();
    expect(key.length).toBe(32);
    first.create(CODE);
    await first.flush();
    expect(loadState(statePath).ticketKey).toBe(key.toString('base64url'));
    const second = registryAt(statePath);
    expect(second.ensureTicketKey().equals(key)).toBe(true);
  });

  it('ignores a key that is not 32 bytes of base64url and makes a new one', () => {
    const statePath = join(directory(), 'state.json');
    writeFileSync(statePath, JSON.stringify({ version: 1, tables: {}, ticketKey: 'short' }));
    expect(loadState(statePath).ticketKey).toBeNull();
  });
});
