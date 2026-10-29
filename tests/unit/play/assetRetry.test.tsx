// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetLoader, type LoadedAsset } from '../../../apps/play/src/assets/AssetLoader.ts';
import { memoryCache } from '../../../apps/play/src/assets/blobCache.ts';
import { useAssetUrl } from '../../../apps/play/src/assets/useAssetUrl.ts';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import { InitiativePanel } from '../../../apps/play/src/ui/InitiativePanel.tsx';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { SharedInitiative } from '../../../src/app/online/protocol/initiative.ts';

afterEach(cleanup);
initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const ref = (c: string): AssetRef => ({ hash: c.repeat(64), size: 1, mime: 'image/png' });
const asset: LoadedAsset = { bytes: new Uint8Array([1]), mime: 'image/png', width: null, height: null };

/** A loader that fails until `online` is set, with the reconnect signal of the real one. */
function fake(): { load: ReturnType<typeof vi.fn>; onReconnect: (l: () => void) => () => void; back: () => void; online: { on: boolean } } {
  const listeners = new Set<() => void>();
  const online = { on: false };
  return {
    load: vi.fn(async () => (online.on ? asset : null)),
    onReconnect: (l) => { listeners.add(l); return () => void listeners.delete(l); },
    back: () => { online.on = true; for (const l of [...listeners]) l(); },
    online,
  };
}

describe('AssetLoader.onReconnect', () => {
  it('fires on setConnected(true) after false, once, and not after unsubscribing', () => {
    const loader = new AssetLoader({ send: () => undefined, cache: memoryCache(), now: () => 0 });
    const listener = vi.fn();
    const off = loader.onReconnect(listener);
    loader.setConnected(true);
    expect(listener).not.toHaveBeenCalled();
    loader.setConnected(false);
    loader.setConnected(true);
    loader.setConnected(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    loader.setConnected(false);
    loader.setConnected(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('asks again for failed art after reconnect', () => {
  it('an initiative portrait that failed loads again once and shows the art', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const assets = fake();
    const initiative: SharedInitiative = {
      isActive: true, round: 1, bySides: false, firstSide: 'players', activeSide: null,
      combatants: [{ initiative: 1, name: 'Ash', turn: false, sitsOut: false, art: ref('a'), ring: null, side: 'players', hp: null }],
    };
    const { container } = render(<InitiativePanel assets={assets} initiative={initiative} />);
    await waitFor(() => expect(assets.load).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('img')).toBeNull();
    await act(async () => { assets.back(); });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    expect(assets.load).toHaveBeenCalledTimes(2);
    await act(async () => { assets.back(); });
    expect(assets.load).toHaveBeenCalledTimes(2);
  });

  it('a hook that unmounted, or whose ref changed, does not ask again', async () => {
    const assets = fake();
    function Probe({ r }: { r: AssetRef }): null { useAssetUrl(assets, r, 64); return null; }
    const view = render(<Probe r={ref('a')} />);
    await waitFor(() => expect(assets.load).toHaveBeenCalledTimes(1));
    view.rerender(<Probe r={ref('b')} />);
    await waitFor(() => expect(assets.load).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    assets.back();
    expect(assets.load).toHaveBeenCalledTimes(2);
  });

  it('a hook whose load succeeded asks nothing', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const assets = fake();
    assets.online.on = true;
    function Probe(): null { useAssetUrl(assets, ref('a'), 64); return null; }
    render(<Probe />);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    assets.back();
    expect(assets.load).toHaveBeenCalledTimes(1);
  });
});
