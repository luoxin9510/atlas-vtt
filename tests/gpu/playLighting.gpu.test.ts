import { Application } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLoader, LoadedAsset } from '../../apps/play/src/assets/AssetLoader';
import { canRunLighting } from '../../apps/play/src/lighting/lightingProbe';
import { LIGHTING_ATTEMPT_KEY } from '../../apps/play/src/lighting/storedAttempt';
import { SceneView } from '../../apps/play/src/scene/SceneView';
import { createTableStore, type TableStoreApi } from '../../apps/play/src/state/tableStore';
import type { SharedScene } from '../../src/app/online/protocol/index';

const MAP_REF = { hash: 'b'.repeat(64), size: 10, mime: 'image/png' } as SharedScene['map'];
const CLEAR = [0x1b, 0x1b, 0x1f];
/** 512 world px of map fit 200 screen px. */
const SCALE = 200 / 512;

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
  localStorage.removeItem(LIGHTING_ATTEMPT_KEY);
});

async function whiteMap(): Promise<LoadedAsset> {
  const canvas = new OffscreenCanvas(512, 512);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 512, 512);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes, mime: 'image/png', width: null, height: null };
}

async function open(store: TableStoreApi): Promise<{ view: SceneView; load: ReturnType<typeof vi.fn> }> {
  const element = document.createElement('div');
  element.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
  document.body.appendChild(element);
  cleanup.push(() => element.remove());
  const asset = await whiteMap();
  const load = vi.fn(async (): Promise<LoadedAsset | null> => asset);
  const view = new SceneView(element, store, { load, cancel: vi.fn() } as Pick<AssetLoader, 'load' | 'cancel'>, true);
  cleanup.push(() => view.destroy());
  await view.whenReady();
  return { view, load };
}

function pixelAt(view: SceneView, x: number, y: number): number[] {
  view.app.render();
  const copy = new OffscreenCanvas(view.app.canvas.width, view.app.canvas.height).getContext('2d')!;
  copy.drawImage(view.app.canvas, 0, 0);
  const data = copy.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

const mapVisible = (view: SceneView): boolean => (view as unknown as { map: { layer: { visible: boolean } } }).map.layer.visible;
const isClear = (p: number[]): boolean => p.every((v, i) => Math.abs(v - CLEAR[i]!) <= 3);
const isBlack = (p: number[]): boolean => p.every((v) => v <= 6);

/** A closed room (50,50)-(250,250), a lamp in it and the party's one vision token. Everything else is dark. */
const ROOM = [[50, 50, 250, 50], [250, 50, 250, 250], [250, 250, 50, 250], [50, 250, 50, 50]] as const;
function lit(store: TableStoreApi, parts: { sight?: boolean; fog?: boolean } = {}): void {
  store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
  if (parts.fog !== false) store.applyMessage({ t: 'fog', scene: 's1', fog: [] }, 0);
  store.applyMessage({ t: 'lighting', scene: 's1', cellSize: 70, unitDistance: 5, walls: ROOM.map((p) => ({ p })), zones: [], senses: [] }, 0);
  if (parts.sight === false) return;
  store.applyMessage({
    t: 'sight', scene: 's1', seq: 1, lighting: { enabled: true, ambient: 0 },
    lights: [{ id: 'lamp', x: 150, y: 150, emission: { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: 'none' } }],
    tokens: [{ id: 'eye', x: 100, y: 150, size: 1, vision: { senses: [] } }], held: [],
  }, 0);
}

describe('player lit scenes', () => {
  it('lights only what the token sees', async () => {
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    await vi.waitFor(() => expect(store.getState().mode).toBe('lit'));
    // Inside the room: lit by the lamp. Behind its wall: the unexplored colour.
    await vi.waitFor(() => expect(pixelAt(view, 150 * SCALE, 150 * SCALE)[0]).toBeGreaterThan(100), { timeout: 10_000 });
    expect(isBlack(pixelAt(view, 400 * SCALE, 150 * SCALE))).toBe(true);
    expect(isBlack(pixelAt(view, 150 * SCALE, 400 * SCALE))).toBe(true);
    expect(isBlack(pixelAt(view, 20 * SCALE, 20 * SCALE))).toBe(true);
  });

  it('keeps the map hidden until sight is current', async () => {
    const store = createTableStore();
    const { view, load } = await open(store);
    lit(store, { sight: false });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(store.getState().mode).toBe('lit');
    expect(mapVisible(view)).toBe(false);
    for (const x of [10, 60, 100, 150, 190]) for (const y of [10, 60, 100, 150, 190]) expect(isClear(pixelAt(view, x, y))).toBe(true);
    // The GM sends sight: only then does the map show, lit.
    store.applyMessage({
      t: 'sight', scene: 's1', seq: 1, lighting: { enabled: true, ambient: 0 }, lights: [],
      tokens: [{ id: 'eye', x: 100, y: 150, size: 1, vision: { senses: [] } }], held: [],
    }, 0);
    await vi.waitFor(() => expect(mapVisible(view)).toBe(true), { timeout: 10_000 });
    expect(isBlack(pixelAt(view, 400 * SCALE, 150 * SCALE))).toBe(true);
  });

  it('hides the map again when the GM resends the scene, until sight returns', async () => {
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    await vi.waitFor(() => expect(mapVisible(view)).toBe(true), { timeout: 10_000 });
    store.applyMessage({ t: 'scene', scene: { id: 's1', map: MAP_REF, lit: true } }, 0);
    expect(store.getState().lit.sight).toBeNull();
    await vi.waitFor(() => expect(mapVisible(view)).toBe(false));
    for (const x of [10, 60, 100, 150, 190]) expect(isClear(pixelAt(view, x, 60))).toBe(true);
    for (const x of [10, 100, 190]) expect(isClear(pixelAt(view, x, 100))).toBe(true);
  });

  it('falls back to the placeholder on context loss', async () => {
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    await vi.waitFor(() => expect(mapVisible(view)).toBe(true), { timeout: 10_000 });
    const gl = (view.app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
    await vi.waitFor(() => expect(store.getState().mode).toBe('placeholder'));
    expect(store.getState().lighting).toBe('unsupported');
    expect(mapVisible(view)).toBe(false);
    expect(store.getState().tokens).toEqual([]);
    // The session stays unsupported: a later lit scene is a placeholder too.
    store.applyMessage({ t: 'scene', scene: { id: 's2', map: MAP_REF, lit: true } }, 0);
    expect(store.getState().mode).toBe('placeholder');
  });

  it('shows the placeholder and requests no map where the probe fails', async () => {
    const store = createTableStore();
    const { view, load } = await open(store);
    (view.app.renderer as unknown as { gl: WebGL2RenderingContext }).gl.getExtension = (): null => null;
    lit(store);
    expect(store.getState().lighting).toBe('unsupported');
    expect(store.getState().mode).toBe('placeholder');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(load).not.toHaveBeenCalled();
    expect(isClear(pixelAt(view, 100, 100))).toBe(true);
  });

  it('fails closed when an earlier attempt never finished', async () => {
    localStorage.setItem(LIGHTING_ATTEMPT_KEY, String(Date.now()));
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    await vi.waitFor(() => expect(store.getState().mode).toBe('placeholder'), { timeout: 10_000 });
    expect(mapVisible(view)).toBe(false);
    expect(isClear(pixelAt(view, 100, 100))).toBe(true);
  });

  it('draws sensed outlines and door badges', async () => {
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    store.applyMessage({ t: 'doors', scene: 's1', doors: [{ p: [250, 120, 250, 180], open: false }] }, 0);
    store.applyMessage({ t: 'sensed', scene: 's1', tokens: [{ x: 400, y: 300, size: 80 }] }, 0);
    const red = (): boolean => { const [r, g, b] = pixelAt(view, 250 * SCALE, 150 * SCALE); return r! > 150 && g! < 90 && b! < 90; };
    await vi.waitFor(() => expect(red()).toBe(true), { timeout: 10_000 });
    // The outline is a light ring of the token's footprint, drawn over the dark.
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].some((i) => {
      const a = (i * Math.PI) / 4;
      return pixelAt(view, (400 + 40 * Math.cos(a)) * SCALE, (300 + 40 * Math.sin(a)) * SCALE).every((v) => v > 120);
    });
    expect(ring).toBe(true);
  });

  it('draws the tokens under the lighting and the fog over it', async () => {
    const store = createTableStore();
    const { view } = await open(store);
    lit(store);
    const token = { id: 'a'.repeat(24), x: 400, y: 150, size: 100, cells: 1, rotation: 0, art: null, name: null, ring: null, claim: null, badge: null, ui: null };
    store.applyMessage({ t: 'tokens', scene: 's1', tokens: [token], cell: 70, snap: null }, 0);
    await vi.waitFor(() => expect(store.getState().mode).toBe('lit'));
    await vi.waitFor(() => expect(pixelAt(view, 150 * SCALE, 150 * SCALE)[0]).toBeGreaterThan(100), { timeout: 10_000 });
    // The token stands in the dark behind the wall: the lighting covers it whole.
    expect(isBlack(pixelAt(view, 400 * SCALE, 150 * SCALE))).toBe(true);
    // Fog over the lit room covers it.
    store.applyMessage({ t: 'fog', scene: 's1', fog: [{ type: 'rectangle', erase: false, x: 0, y: 0, width: 512, height: 512 }] }, 0);
    await vi.waitFor(() => expect(isBlack(pixelAt(view, 150 * SCALE, 150 * SCALE))).toBe(true));
  });
});

describe('the lighting probe', () => {
  it('passes on a renderer with float render targets, once, and fails without the extensions', async () => {
    const good = new Application();
    await good.init({ preference: 'webgl', width: 16, height: 16 });
    cleanup.push(() => good.destroy(true));
    expect(canRunLighting(good.renderer)).toBe(true);
    const gl = (good.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    gl.getExtension = (): null => null;
    expect(canRunLighting(good.renderer)).toBe(true);

    const bad = new Application();
    await bad.init({ preference: 'webgl', width: 16, height: 16 });
    cleanup.push(() => bad.destroy(true));
    (bad.renderer as unknown as { gl: WebGL2RenderingContext }).gl.getExtension = (): null => null;
    expect(canRunLighting(bad.renderer)).toBe(false);
  });

  it('leaves the renderer able to draw', async () => {
    const app = new Application();
    await app.init({ preference: 'webgl', width: 16, height: 16, backgroundColor: 0x336699 });
    cleanup.push(() => app.destroy(true));
    expect(canRunLighting(app.renderer)).toBe(true);
    app.render();
    const copy = new OffscreenCanvas(16, 16).getContext('2d')!;
    copy.drawImage(app.canvas, 0, 0);
    expect(Array.from(copy.getImageData(8, 8, 1, 1).data.slice(0, 3))).toEqual([0x33, 0x66, 0x99]);
  });
});
