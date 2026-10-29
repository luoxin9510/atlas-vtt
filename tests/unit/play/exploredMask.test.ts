import { describe, expect, it, vi } from 'vitest';
import type { LoadedAsset } from '../../../apps/play/src/assets/AssetLoader.ts';
import { ExploredMask } from '../../../apps/play/src/scene/exploredMask.ts';
import { dataUrlOfPng } from '../../../apps/play/src/scene/pngDataUrl.ts';

const ref = (hash: string): { hash: string; size: number; mime: string } => ({ hash: hash.repeat(64), size: 10, mime: 'image/png' });
const asset = (byte: number): LoadedAsset => ({ bytes: new Uint8Array([byte]), mime: 'image/png', width: 1, height: 1 });

function setup(): {
  mask: ExploredMask; set: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>;
  answers: Array<{ hash: string; resolve: (asset: LoadedAsset | null) => void }>; fireReconnect: () => void; listeners: () => number;
} {
  const answers: Array<{ hash: string; resolve: (asset: LoadedAsset | null) => void }> = [];
  const load = vi.fn((r: { hash: string }) => new Promise<LoadedAsset | null>((resolve) => { answers.push({ hash: r.hash, resolve }); }));
  const callbacks = new Set<() => void>();
  const assets = { load, onReconnect: (cb: () => void): (() => void) => { callbacks.add(cb); return () => { callbacks.delete(cb); }; } };
  const set = vi.fn();
  const mask = new ExploredMask(assets as never, set);
  return { mask, set, load, answers, fireReconnect: () => { for (const cb of [...callbacks]) cb(); }, listeners: () => callbacks.size };
}
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('ExploredMask', () => {
  it('asks again after a reconnect when the first load answered null', async () => {
    const { mask, set, load, answers, fireReconnect } = setup();
    mask.follow(ref('a'));
    answers[0]!.resolve(null);
    await settle();
    expect(set).toHaveBeenLastCalledWith(null);
    fireReconnect();
    expect(load).toHaveBeenCalledTimes(2);
    answers[1]!.resolve(asset(1));
    await settle();
    expect(set).toHaveBeenLastCalledWith(dataUrlOfPng(asset(1).bytes));
  });

  it('does not load a loaded mask again on a reconnect', async () => {
    const { mask, load, answers, fireReconnect } = setup();
    mask.follow(ref('a'));
    answers[0]!.resolve(asset(1));
    await settle();
    fireReconnect();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('ignores a late answer for a ref that is no longer current', async () => {
    const { mask, set, answers } = setup();
    mask.follow(ref('a'));
    mask.follow(ref('b'));
    answers[0]!.resolve(asset(1));
    await settle();
    expect(set).not.toHaveBeenCalledWith(dataUrlOfPng(asset(1).bytes));
    answers[1]!.resolve(asset(2));
    await settle();
    expect(set).toHaveBeenLastCalledWith(dataUrlOfPng(asset(2).bytes));
  });

  it('loads nothing after destroy and stops listening', () => {
    const { mask, load, answers, fireReconnect, listeners } = setup();
    mask.follow(ref('a'));
    expect(answers).toHaveLength(1);
    mask.destroy();
    fireReconnect();
    expect(load).toHaveBeenCalledTimes(1);
    expect(listeners()).toBe(0);
  });

  it('fails closed: only a url the loader returned for the current ref is ever set', async () => {
    const { mask, set, answers, fireReconnect } = setup();
    mask.follow(ref('a'));
    mask.follow(ref('b'));
    expect(set.mock.calls.every(([url]) => url === null)).toBe(true);
    answers[0]!.resolve(asset(1));
    answers[1]!.resolve(null);
    await settle();
    fireReconnect(); // retries b (ref b still has no url); a's stale answer must stay unused
    answers[2]!.resolve(asset(9));
    answers[0]!.resolve(asset(1));
    await settle();
    const urls = set.mock.calls.map(([url]) => url as string | null).filter((u) => u !== null);
    expect(urls).toEqual([dataUrlOfPng(asset(9).bytes)]);
    mask.follow(null);
    expect(set).toHaveBeenLastCalledWith(null);
  });

  it('sets null while a changed ref loads, never the old url', async () => {
    const { mask, set, answers } = setup();
    mask.follow(ref('a'));
    answers[0]!.resolve(asset(1));
    await settle();
    mask.follow(ref('b'));
    expect(set).toHaveBeenLastCalledWith(null);
  });
});
