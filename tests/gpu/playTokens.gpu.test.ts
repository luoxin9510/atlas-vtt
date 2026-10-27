import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLoader, LoadedAsset } from '../../apps/play/src/assets/AssetLoader';
import { SceneView } from '../../apps/play/src/scene/SceneView';
import { createTableStore, type TableStoreApi } from '../../apps/play/src/state/tableStore';
import type { SharedScene, SharedToken } from '../../src/app/online/protocol/index';

const MAP_REF = { hash: 'b'.repeat(64), size: 10, mime: 'image/png' } as SharedScene['map'];
const MAP_GREEN = [0x2e, 0xcc, 0x40];
const DISC = [0x4a, 0x4d, 0x5a];
const FOG = [0, 0, 0];

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function mapAsset(): Promise<LoadedAsset> {
  const canvas = new OffscreenCanvas(512, 512);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#2ecc40';
  context.fillRect(0, 0, 512, 512);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes, mime: 'image/png', width: null, height: null };
}

async function redArt(): Promise<LoadedAsset> {
  const canvas = new OffscreenCanvas(64, 64);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 64, 64);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes, mime: 'image/png', width: 64, height: 64 };
}

async function open(store: TableStoreApi): Promise<SceneView> {
  const element = document.createElement('div');
  element.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
  document.body.appendChild(element);
  cleanup.push(() => element.remove());
  const asset = await mapAsset();
  const art = await redArt();
  const view = new SceneView(element, store, { load: vi.fn(async (ref: { hash: string }): Promise<LoadedAsset | null> => (ref.hash === 'e'.repeat(64) ? art : asset)) } as Pick<AssetLoader, 'load'>, true);
  cleanup.push(() => view.destroy());
  await view.whenReady();
  return view;
}

function pixelAt(view: SceneView, x: number, y: number): number[] {
  view.app.render();
  const copy = new OffscreenCanvas(view.app.canvas.width, view.app.canvas.height).getContext('2d')!;
  copy.drawImage(view.app.canvas, 0, 0);
  const data = copy.getImageData(x, y, 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= 4);
const token = (id: string, x: number, y: number): SharedToken => ({
  id, x, y, size: 100, cells: 1, rotation: 0, art: null, name: null, ring: null, claim: null, badge: null, ui: null,
});
const ID_A = 'a'.repeat(24);
const ID_B = 'c'.repeat(24);

function scene(store: TableStoreApi): void {
  store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: false } }, 0);
  // The left half of the 512 px map is under fog; 512 world px show in 200 screen px.
  store.applyMessage({ t: 'fog', scene: 's1', fog: [{ type: 'rectangle', erase: false, x: 0, y: 0, width: 256, height: 512 }] }, 0);
}

describe('player tokens, pins and drawings', () => {
  it('hides a token under covering fog and shows one outside it', async () => {
    const store = createTableStore();
    const view = await open(store);
    scene(store);
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token(ID_A, 128, 256), token(ID_B, 384, 256)] }, 0);
    await vi.waitFor(() => expect(near(pixelAt(view, 150, 100), DISC)).toBe(true));
    expect(near(pixelAt(view, 50, 100), FOG)).toBe(true);
  });

  it('draws a shared pen drawing and a pin on the map', async () => {
    const store = createTableStore();
    const view = await open(store);
    scene(store);
    store.applyMessage({ t: 'annotations', scene: 's1', drawings: [{ type: 'pen', points: [300, 400, 500, 400], colour: '#ff0000', width: 40, opacity: 1 }], texts: [] }, 0);
    await vi.waitFor(() => expect(near(pixelAt(view, 160, 156), [255, 0, 0])).toBe(true));
    store.applyMessage({ t: 'pins', scene: 's1', pins: [{ id: 'd'.repeat(24), x: 384, y: 100, icon: 'pin', found: null }] }, 0);
    // The pin's centre (screen 150, 39) is its badge or glyph, never the map's green.
    await vi.waitFor(() => expect(near(pixelAt(view, 150, 39), MAP_GREEN)).toBe(false));
  });

  it('draws token art inside a circle, not in the corners of its box', async () => {
    const store = createTableStore();
    const view = await open(store);
    scene(store);
    const withArt: SharedToken = { ...token(ID_B, 384, 256), art: { hash: 'e'.repeat(64), size: 10, mime: 'image/png' } };
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [withArt] }, 0);
    await vi.waitFor(() => expect(near(pixelAt(view, 150, 100), [255, 0, 0])).toBe(true));
    // Token box is 100 world px (39 screen px); its corner lies outside the disc.
    expect(near(pixelAt(view, 150 + 18, 100 + 18), MAP_GREEN)).toBe(true);
  });
});
