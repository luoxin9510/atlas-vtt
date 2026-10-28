import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLoader, LoadedAsset } from '../../apps/play/src/assets/AssetLoader';
import { SceneView } from '../../apps/play/src/scene/SceneView';
import { createTableStore, type TableStoreApi } from '../../apps/play/src/state/tableStore';
import { SceneCanvas } from '../../apps/play/src/ui/SceneCanvas';
import type { SharedScene } from '../../src/app/online/protocol/index';

const MAP_REF = { hash: 'b'.repeat(64), size: 10, mime: 'image/png' } as SharedScene['map'];
const CLEAR = [0x1b, 0x1b, 0x1f];
const MAP_GREEN = [0x2e, 0xcc, 0x40];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mapAsset(): Promise<LoadedAsset> {
  const canvas = new OffscreenCanvas(512, 512);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#2ecc40';
  context.fillRect(0, 0, 512, 512);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes, mime: 'image/png', width: null, height: null };
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

function host(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
  document.body.appendChild(element);
  cleanup.push(() => element.remove());
  return element;
}

async function openView(store: TableStoreApi, loader?: () => Promise<LoadedAsset | null>): Promise<{ view: SceneView; load: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> {
  const asset = await mapAsset();
  const load = vi.fn(loader ?? (async (): Promise<LoadedAsset | null> => asset));
  const cancel = vi.fn();
  const view = new SceneView(host(), store, { load, cancel } as Pick<AssetLoader, 'load' | 'cancel'>, true);
  cleanup.push(() => view.destroy());
  await view.whenReady();
  return { view, load, cancel };
}

function pixelAt(view: SceneView, x: number, y: number): number[] {
  view.app.render();
  const copy = new OffscreenCanvas(view.app.canvas.width, view.app.canvas.height).getContext('2d')!;
  copy.drawImage(view.app.canvas, 0, 0);
  const data = copy.getImageData(x, y, 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

const unlit = (store: TableStoreApi): void => store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: false } }, 0);
const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 3);

describe('player scene view', () => {
  it('covers the map where the fog is null and shows it where the fog is empty', async () => {
    const store = createTableStore();
    const { view, load } = await openView(store);
    unlit(store);
    store.applyMessage({ t: 'fog', scene: 's1', fog: null }, 0);
    await vi.waitFor(() => expect(pixelAt(view, 100, 100)).toEqual([0, 0, 0]));
    expect(load).toHaveBeenCalledTimes(1);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    await vi.waitFor(() => expect(near(pixelAt(view, 100, 100), MAP_GREEN)).toBe(true));
  });

  it('draws the shared grid over the map and under the fog', async () => {
    const store = createTableStore();
    const { view } = await openView(store);
    unlit(store);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    store.applyMessage({ t: 'grid', scene: 's1', grid: { type: 'square', size: 64, offsetX: 0, offsetY: 0, colour: '#ff0000', alpha: 1, lineWidth: 3, lineType: 'solid', numbers: null } }, 0);
    // 512 world px fit in 200 screen px, so the line at world x = 64 is near screen x = 25.
    const reddish = (): boolean => [22, 23, 24, 25, 26, 27, 28].some((x) => { const [r, g] = pixelAt(view, x, 100); return r! > 150 && g! < 100; });
    await vi.waitFor(() => expect(reddish()).toBe(true));
    store.applyMessage({ t: 'fog', scene: 's1', fog: null }, 0);
    await vi.waitFor(() => expect(pixelAt(view, 25, 100)).toEqual([0, 0, 0]));
  });

  it('drops a map that arrives after the scene turned lit', async () => {
    const store = createTableStore();
    const asset = await mapAsset();
    let release: (a: LoadedAsset) => void = () => undefined;
    const { view, load, cancel } = await openView(store, () => new Promise((resolve) => { release = resolve; }));
    unlit(store);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // On a device that cannot light it, a scene that turns lit is a placeholder (lit scenes on a capable device: playLighting.gpu.test.ts).
    store.setLighting('unsupported');
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
    // The download is given up: nothing keeps asking the GM for a lit scene's map.
    expect(cancel).toHaveBeenCalledWith(MAP_REF!.hash);
    release(asset);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(near(pixelAt(view, 100, 100), CLEAR)).toBe(true);
  });

  it('drops a map that arrives after the scene changed', async () => {
    const store = createTableStore();
    const asset = await mapAsset();
    const releases: Array<(a: LoadedAsset) => void> = [];
    const { view, load } = await openView(store, () => new Promise((resolve) => { releases.push(resolve); }));
    unlit(store);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const other = { hash: 'c'.repeat(64), size: 10, mime: 'image/png' } as SharedScene['map'];
    store.applyMessage({ t: 'scene', scene: { id: 's2', map: other, lit: false } }, 0);
    store.applyMessage({ t: 'fog', scene: 's2', fog: [] }, 0);
    releases[0]!(asset);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(load).toHaveBeenCalledTimes(2);
    // The first request's answer is ignored; the second (still pending) draws nothing yet.
    expect(near(pixelAt(view, 100, 100), CLEAR)).toBe(true);
  });

  it('fits a map whose world is far larger than the screen', async () => {
    const store = createTableStore();
    const asset = await mapAsset();
    const { view } = await openView(store, async () => ({ ...asset, width: 8000, height: 6000 }));
    unlit(store);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    // 8000 x 6000 in 200 x 200: the whole map shows (scale 0.025, below the usual minimum zoom of 0.1).
    await vi.waitFor(() => expect(near(pixelAt(view, 100, 50), MAP_GREEN)).toBe(true));
    expect(near(pixelAt(view, 100, 150), MAP_GREEN)).toBe(true);
    expect(near(pixelAt(view, 100, 190), CLEAR)).toBe(true);
  });

  it('draws nothing of the map until the fog arrives', async () => {
    const store = createTableStore();
    const { view } = await openView(store);
    unlit(store);
    await vi.waitFor(() => expect(store.getState().mode).toBe('unlit'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(near(pixelAt(view, 100, 100), CLEAR)).toBe(true);
  });

  it('never requests nor draws a lit scene where lighting is unsupported', async () => {
    const store = createTableStore();
    const { view, load } = await openView(store);
    store.setLighting('unsupported');
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
    store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(load).not.toHaveBeenCalled();
    for (const [x, y] of [[10, 10], [100, 100], [190, 190]] as const) expect(near(pixelAt(view, x, y), CLEAR)).toBe(true);
  });

  it('shows the placeholder text over a lit scene this device cannot light', async () => {
    const store = createTableStore();
    store.setLighting('unsupported');
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
    const element = host();
    const root: Root = createRoot(element);
    cleanup.push(() => act(() => root.unmount()));
    await act(async () => { root.render(createElement(SceneCanvas, { store, assets: { load: vi.fn(), cancel: vi.fn() }, lowPower: true })); });
    expect(element.textContent ?? '').toMatch(/cannot show dynamic lighting|无法显示动态光照/);
    expect(element.querySelector('.atlas-play-lit')).not.toBeNull();
  });

  it('says it is preparing the lighting while a lit scene has no sight yet', async () => {
    const store = createTableStore();
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
    const element = host();
    const root: Root = createRoot(element);
    cleanup.push(() => act(() => root.unmount()));
    const load = vi.fn(async (): Promise<LoadedAsset | null> => mapAsset());
    await act(async () => { root.render(createElement(SceneCanvas, { store, assets: { load, cancel: vi.fn() }, lowPower: true })); });
    await vi.waitFor(() => expect(store.getState().mode).toBe('lit'));
    expect(element.textContent ?? '').toMatch(/Preparing lighting|正在准备光照/);
  });
});
