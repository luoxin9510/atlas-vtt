// @vitest-environment jsdom
import type { Plugin } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineFeature } from '../../../../src/app/online/gm/OnlineFeature.ts';
import { relayOrigin, UPSTREAM_RELAY_ORIGIN } from '../../../../src/app/online/gm/servers.ts';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { useUpstreamServer } from './upstreamServer.ts';

useUpstreamServer();

const ORIGIN = 'https://tables.example.com';

/** Lets the pending promises of the feature's start run. */
const settled = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};

/** A feature whose data file is read when `release` is called with it. */
function pending(): { feature: OnlineFeature; release: (data: unknown) => void } {
  const vault = createInMemoryApp();
  let release: (data: unknown) => void = () => undefined;
  const read = new Promise<unknown>((resolve) => { release = resolve; });
  const feature = new OnlineFeature({ app: vault.app, manifest: { version: '0' } } as unknown as Plugin, { read: () => read, write: () => Promise.resolve() } as never);
  // The mock Component has no registerEvent, which start() reaches once the data was read.
  (feature as unknown as { registerEvent: () => void }).registerEvent = () => undefined;
  return { feature, release };
}

/** What Obsidian does when it unloads a component. */
function unloadFeature(feature: OnlineFeature): void {
  feature.onunload();
  feature.unload();
}

afterEach(() => vi.restoreAllMocks());

describe('the server address of online play follows the feature\'s life', () => {
  it('is applied once the data was read, and the settings sections appear', async () => {
    const { feature, release } = pending();
    feature.onload();
    expect(feature.settingsSections()).toEqual([]);
    release({ serverOrigin: ORIGIN });
    await settled();
    expect(relayOrigin()).toBe(ORIGIN);
    expect(feature.settingsSections().length).toBeGreaterThan(0);
    unloadFeature(feature);
  });

  it('is gone again when the feature unloads', async () => {
    const { feature, release } = pending();
    feature.onload();
    release({ serverOrigin: ORIGIN });
    await settled();
    expect(relayOrigin()).toBe(ORIGIN);
    unloadFeature(feature);
    expect(relayOrigin()).toBeNull();
  });

  it('is never applied when the feature unloads while the data is still being read', async () => {
    const { feature, release } = pending();
    feature.onload();
    unloadFeature(feature);
    release({ serverOrigin: ORIGIN });
    await settled();
    // Still the server the test began with.
    expect(relayOrigin()).toBe(UPSTREAM_RELAY_ORIGIN);
    expect(feature.settingsSections()).toEqual([]);
  });
});
