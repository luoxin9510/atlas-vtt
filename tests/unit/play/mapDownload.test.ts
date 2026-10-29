import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../../../apps/play/src/assets/AssetLoader.ts';
import { MAP_MAX_ATTEMPTS, MAP_RETRY_MAX_MS, MAP_RETRY_MS, MapDownload, type MapWish } from '../../../apps/play/src/scene/MapDownload.ts';

const mapWish = (hash: string): MapWish => ({ ref: { hash: hash.repeat(64), size: 10, mime: 'image/png' }, maxSide: 4096 });
const ASSET: LoadedAsset = { bytes: new Uint8Array([1]), mime: 'image/png', width: 1, height: 1 };

function setup(): { download: MapDownload; load: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; arrived: string[]; answer: Array<(asset: LoadedAsset | null) => void> } {
  const answer: Array<(asset: LoadedAsset | null) => void> = [];
  const load = vi.fn(() => new Promise<LoadedAsset | null>((resolve) => { answer.push(resolve); }));
  const cancel = vi.fn();
  const arrived: string[] = [];
  const download = new MapDownload({
    assets: { load, cancel }, arrived: (key) => arrived.push(key),
    setTimer: (run, ms) => setTimeout(run, ms), clearTimer: (timer) => clearTimeout(timer),
  });
  return { download, load, cancel, arrived, answer };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('MapDownload', () => {
  it('asks once for a scene however often it is synced, and reports the map for its key', async () => {
    const { download, load, arrived, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    download.sync('s1:a', () => mapWish('a'), true);
    expect(load).toHaveBeenCalledTimes(1);
    answer[0]!(ASSET);
    await vi.advanceTimersByTimeAsync(0);
    expect(arrived).toEqual(['s1:a']);
  });

  it('asks again once the table is back after a download lost with the connection', async () => {
    const { download, load, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    download.sync('s1:a', () => mapWish('a'), false);
    answer[0]!(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    download.sync('s1:a', () => mapWish('a'), false);
    download.sync('s1:a', () => mapWish('a'), true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('calls the wish once per key however often it is synced, and again for a new key', () => {
    const { download } = setup();
    const ask = vi.fn(() => mapWish('a'));
    download.sync('s1:a', ask, true);
    download.sync('s1:a', ask, true);
    download.sync('s1:a', ask, false);
    expect(ask).toHaveBeenCalledTimes(1);
    download.sync('s2:a', ask, true);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('backs off 10 s, 20 s, 40 s ... capped at 5 min, measured from each failed answer', async () => {
    const { download, load, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    const started: number[] = [Date.now()];
    for (let n = 0; n < MAP_MAX_ATTEMPTS - 1; n += 1) {
      answer[n]!(null);
      await vi.advanceTimersByTimeAsync(0);
      const delay = Math.min(MAP_RETRY_MS * 2 ** n, MAP_RETRY_MAX_MS);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(load).toHaveBeenCalledTimes(n + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(n + 2);
      started.push(Date.now());
    }
    const gaps = started.slice(1).map((t, i) => t - started[i]!);
    expect(gaps).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('stops after 8 failures but stays failed', async () => {
    const { download, load, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    for (let n = 0; n < MAP_MAX_ATTEMPTS; n += 1) {
      answer[n]!(null);
      await vi.advanceTimersByTimeAsync(MAP_RETRY_MAX_MS);
    }
    expect(load).toHaveBeenCalledTimes(MAP_MAX_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(load).toHaveBeenCalledTimes(MAP_MAX_ATTEMPTS);
  });

  it('a reconnect after giving up asks again with a fresh count', async () => {
    const { download, load, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    for (let n = 0; n < MAP_MAX_ATTEMPTS; n += 1) {
      answer[n]!(null);
      await vi.advanceTimersByTimeAsync(MAP_RETRY_MAX_MS);
    }
    download.sync('s1:a', () => mapWish('a'), false);
    download.sync('s1:a', () => mapWish('a'), true);
    expect(load).toHaveBeenCalledTimes(MAP_MAX_ATTEMPTS + 1);
    for (let n = 0; n < MAP_MAX_ATTEMPTS; n += 1) {
      answer[MAP_MAX_ATTEMPTS + n]!(null);
      await vi.advanceTimersByTimeAsync(MAP_RETRY_MAX_MS);
    }
    expect(load).toHaveBeenCalledTimes(MAP_MAX_ATTEMPTS * 2);
  });

  it('gives the download up when the scene turns lit, ignoring its late answer and asking no more', async () => {
    const { download, load, cancel, arrived, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    download.sync(null, () => null, true);
    expect(cancel).toHaveBeenCalledWith('a'.repeat(64));
    answer[0]!(ASSET);
    await vi.advanceTimersByTimeAsync(MAP_RETRY_MS * 3);
    expect(arrived).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a cancelled download of an old scene starts no retry beside the new scene\'s', async () => {
    const { download, load, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    download.sync('s2:b', () => mapWish('b'), true);
    answer[0]!(null);
    await vi.advanceTimersByTimeAsync(MAP_RETRY_MS * 2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stop cancels and stops the retry', async () => {
    const { download, load, cancel, answer } = setup();
    download.sync('s1:a', () => mapWish('a'), true);
    answer[0]!(null);
    await vi.advanceTimersByTimeAsync(0);
    download.stop();
    await vi.advanceTimersByTimeAsync(MAP_RETRY_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
  });
});
