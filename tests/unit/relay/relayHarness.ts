import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RelayConfig } from '../../../apps/relay/src/config.ts';
import { startRelay, type RunningRelay } from '../../../apps/relay/src/server.ts';

export const TEST_HOST_KEY = 'test-host-key-0123456789abcdef';
export const TEST_PUBLIC_ORIGIN = 'https://play.example.test';

const directories: string[] = [];

/** A relay on a free port with a state file in a temp directory and short timings. */
export async function startTestRelay(overrides: Partial<RelayConfig> = {}): Promise<RunningRelay & { config: RelayConfig }> {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-relay-'));
  directories.push(directory);
  const config: RelayConfig = {
    hostKey: TEST_HOST_KEY,
    host: '127.0.0.1',
    port: 0,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    maxPlayers: 8,
    statePath: join(directory, 'relay-state.json'),
    staticDir: null,
    trustProxy: 'none',
    timing: { knockWaitMs: 500, wrongCodeWindowMs: 1000, wrongCodePauseMs: 1000, unhostedTableMs: 60_000, helloTimeoutMs: 10_000, pingIntervalMs: 30_000 },
    ...overrides,
  };
  const running = await startRelay(config);
  return { ...running, config };
}

/** Removes the temp directories of every relay started so far; call after the relays are closed. */
export function removeTestState(): void {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
}
