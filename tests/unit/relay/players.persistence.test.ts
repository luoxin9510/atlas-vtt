import { describe, expect, it, vi } from 'vitest';
import { CLOSE } from '../../../src/app/online/protocol/relay.ts';
import { MAX_CAMPAIGN_PLAYERS } from '../../../src/app/online/protocol/seat.ts';
import { loadConfig } from '../../../apps/relay/src/config.ts';
import { MAX_KNOWN_PLAYERS } from '../../../apps/relay/src/tables.ts';
import { CODE, createTable, gmOf, joined, playerOf } from './playerHarness.ts';
import { TEST_PUBLIC_ORIGIN } from './relayHarness.ts';
import { useTables } from './tableSuite.ts';

const { running, sockets, start, table } = useTables();

describe('player state over a restart', () => {
  it('keeps player keys over a restart, as hashes only', async () => {
    const first = await start();
    const secret = await createTable(first.origin);
    const gm = await gmOf(first.origin, sockets, secret);
    const { key, id, player: before } = await joined(first.origin, sockets);
    await first.close();
    running.splice(running.indexOf(first), 1);
    // The first relay's late writes (the GM unhosting) must be done before a second one uses the file.
    await Promise.all([gm.closed, before.closed]);
    await vi.waitFor(() => expect(first.links.stateOf(CODE).sockets.size).toBe(0));
    await first.tables.flush();
    const { readFileSync } = await import('node:fs');
    const saved = readFileSync(first.config.statePath, 'utf8');
    expect(saved).not.toContain(key);
    const second = await start({ statePath: first.config.statePath });
    const player = playerOf(second.origin, sockets, { key });
    expect(await player.frameOf('welcome')).toMatchObject({ id, key, gmOnline: false });
  });

  it('fails closed after a restart: a newcomer gets 4013 until a GM sets the gate, a known key still enters', async () => {
    const first = await start();
    const secret = await createTable(first.origin);
    const gm = await gmOf(first.origin, sockets, secret);
    const { key, id, player: before } = await joined(first.origin, sockets);
    await first.close();
    running.splice(running.indexOf(first), 1);
    await Promise.all([gm.closed, before.closed]);
    await vi.waitFor(() => expect(first.links.stateOf(CODE).sockets.size).toBe(0));
    await first.tables.flush();
    const second = await start({ statePath: first.config.statePath });
    expect(await playerOf(second.origin, sockets, { name: 'Newcomer' }).closed).toBe(CLOSE.noAnswer);
    expect(await playerOf(second.origin, sockets, { key }).frameOf('welcome')).toMatchObject({ id, key });
    await gmOf(second.origin, sockets, secret);
    expect((await playerOf(second.origin, sockets, { name: 'Newcomer' }).frameOf('welcome')).role).toBe('player');
  });

  it('counts wrong seat-code guesses and pauses even when the GM set no join code', async () => {
    const { origin, gm } = await table();
    await gm.send({ t: 'players', players: [{ id: 'q'.repeat(20), name: 'Seat', code: '654321' }] });
    for (let attempt = 0; attempt < 4; attempt += 1) expect(await playerOf(origin, sockets, { code: '111111' }).closed).toBe(CLOSE.wrongCode);
    expect(await playerOf(origin, sockets, { code: '111111' }).closed).toBe(CLOSE.paused);
    expect(await playerOf(origin, sockets, { code: '654321' }).closed).toBe(CLOSE.paused);
  });

  it('keeps a roster player\'s key over 130 newcomer cycles; an address gets ten newcomers in ten minutes', { timeout: 60_000 }, async () => {
    const { origin, gm, relay } = await table({ trustProxy: 'xff', maxPlayers: 12 });
    const seat = { id: 'r'.repeat(20), name: 'Real', code: '654321' };
    await gm.send({ t: 'players', players: [seat] });
    const real = playerOf(origin, sockets, { code: '654321' }, { origin: TEST_PUBLIC_ORIGIN, 'x-forwarded-for': '10.0.0.200' });
    const { key } = (await real.frameOf('welcome')) as { key: string };
    real.socket.close();
    await real.closed;
    for (let cycle = 0; cycle < 130; cycle += 1) {
      const address = `10.0.${Math.floor(cycle / 10)}.${cycle % 10}`;
      const newcomer = playerOf(origin, sockets, { name: `N${cycle}` }, { origin: TEST_PUBLIC_ORIGIN, 'x-forwarded-for': address });
      await newcomer.frameOf('welcome');
      newcomer.socket.close();
      await newcomer.closed;
    }
    expect(relay.tables.playerForKey(CODE, key)).toMatchObject({ id: seat.id });
    const headers = { origin: TEST_PUBLIC_ORIGIN, 'x-forwarded-for': '10.9.9.9' };
    for (let count = 0; count < 10; count += 1) {
      const newcomer = playerOf(origin, sockets, {}, headers);
      await newcomer.frameOf('welcome');
      newcomer.socket.close();
    }
    expect(await playerOf(origin, sockets, {}, headers).closed).toBe(CLOSE.rateLimited);
    const again = playerOf(origin, sockets, { key }, headers);
    expect(await again.frameOf('welcome')).toMatchObject({ id: seat.id, key });
  });

  it('writes the state file at most once a second, and close writes what is waiting', async () => {
    const { readFileSync } = await import('node:fs');
    const { origin, relay } = await table();
    const records = (): number => {
      const saved = JSON.parse(readFileSync(relay.config.statePath, 'utf8')) as { tables: Record<string, { players?: object }> };
      return Object.keys(saved.tables[CODE]?.players ?? {}).length;
    };
    await joined(origin, sockets, 'One');
    await vi.waitFor(() => expect(records()).toBe(1), { timeout: 2500 });
    await joined(origin, sockets, 'Two');
    await new Promise((done) => setTimeout(done, 300));
    expect(records()).toBe(1);
    await vi.waitFor(() => expect(records()).toBe(2), { timeout: 2500 });
    await joined(origin, sockets, 'Three');
    await relay.close();
    running.splice(running.indexOf(relay), 1);
    expect(records()).toBe(3);
  });
});

describe('known-player limit', () => {
  it('has room for a full roster plus a full table', () => {
    const env = { HOST_KEY: 'k'.repeat(32), PUBLIC_ORIGIN: 'https://relay.example.com' };
    const MAX_CONNECTED_PLAYERS = loadConfig({ ...env, MAX_PLAYERS: '12' }).maxPlayers;
    expect(() => loadConfig({ ...env, MAX_PLAYERS: String(MAX_CONNECTED_PLAYERS + 1) })).toThrow();
    expect(MAX_CAMPAIGN_PLAYERS + MAX_CONNECTED_PLAYERS).toBeLessThanOrEqual(MAX_KNOWN_PLAYERS);
  });
});
