import { afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { Client, createTable, gmOf } from './playerHarness.ts';
import { removeTestState, startTestRelay } from './relayHarness.ts';

type Relay = Awaited<ReturnType<typeof startTestRelay>>;
type RelayOptions = Parameters<typeof startTestRelay>[0];

export interface Tables {
  running: Relay[];
  sockets: WebSocket[];
  start(...args: Parameters<typeof startTestRelay>): Promise<Relay>;
  table(overrides?: RelayOptions): Promise<{ origin: string; gm: Client; secret: string; relay: Relay }>;
}

/** Call at the top of a test file: registers the `afterEach` that closes every relay and socket it started. */
export function useTables(): Tables {
  const running: Relay[] = [];
  const sockets: WebSocket[] = [];

  async function start(...args: Parameters<typeof startTestRelay>): Promise<Relay> {
    const relay = await startTestRelay(...args);
    running.push(relay);
    return relay;
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(running.splice(0).map((relay) => relay.close()));
    removeTestState();
    vi.restoreAllMocks();
  });

  async function table(overrides: RelayOptions = {}): Promise<{ origin: string; gm: Client; secret: string; relay: Relay }> {
    const relay = await start(overrides);
    const secret = await createTable(relay.origin);
    return { origin: relay.origin, gm: await gmOf(relay.origin, sockets, secret), secret, relay };
  }

  return { running, sockets, start, table };
}
