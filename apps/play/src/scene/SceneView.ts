// Pixi must not use eval (the relay's CSP forbids it): this entry point swaps the shader and uniform-sync
// code generators for ones without it. It is imported once, here, before any renderer is made.
import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { fogCoverage } from '../../../../src/app/fog/fogCoverage.ts';
import { GridSystem, type GridOptions } from '../../../../src/app/grid/GridSystem.ts';
import { parseGridColor } from '../../../../src/app/grid/gridContrastColor.ts';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import type { SharedGrid } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { AssetLoader, LoadedAsset } from '../assets/AssetLoader.ts';
import type { TableState, TableStoreApi } from '../state/tableStore.ts';
import { CanvasInput } from './canvasInput.ts';
import { sharedFogOperations } from './fogAdapter.ts';
import { FogLayer } from './fogLayer.ts';
import type { Gesture } from './gestures.ts';
import { mapRequest } from './mapRequest.ts';
import { MapSprite } from './mapSprite.ts';

export { mapRequest } from './mapRequest.ts';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const CLEAR_COLOUR = 0x1b1b1f;

function gridOptions(grid: SharedGrid): GridOptions {
  return {
    type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY,
    color: parseGridColor(grid.colour ?? undefined), alpha: grid.alpha, lineWidth: grid.lineWidth, lineType: grid.lineType,
    enabled: true, cellNumbers: grid.numbers ?? undefined,
  };
}

function maxTextureSize(app: Application): number {
  const renderer = app.renderer;
  return 'gl' in renderer ? Number(renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE)) : 4096;
}

/**
 * The player's picture of the table: the map, its grid, fog and camera, drawn only from what the GM
 * sent. Layers from the bottom: map, grid, annotations, pins, tokens, fog (so fog covers tokens).
 * Nothing of a scene is requested or drawn unless the store says it is an unlit map scene, and the
 * map stays hidden until the fog has been received.
 */
export class SceneView {
  readonly app = new Application();
  /** Containers Task 8 fills; they sit between the grid and the fog. */
  readonly layers = { annotations: new Container({ label: 'annotations' }), pins: new Container({ label: 'pins' }), tokens: new Container({ label: 'tokens' }) };
  private readonly map = new MapSprite();
  private readonly fogSlot = new Container({ label: 'fog-slot', eventMode: 'none' });
  private viewport: Viewport | null = null;
  private input: CanvasInput | null = null;
  private unsubscribe: (() => void) | null = null;
  private grid: GridSystem | null = null;
  private shownGrid: SharedGrid | null = null;
  private fog: FogLayer | null = null;
  private shownFog: SharedFog | undefined = undefined;
  /** What the loaded or loading picture belongs to: scene id and map hash; null when none. */
  private sceneKey: string | null = null;
  private loaded = false;
  private coverageOf: { fog: SharedFog; value: ReturnType<typeof fogCoverage> } | null = null;
  private maxTexture = 4096;
  private destroyed = false;
  private readonly ready: Promise<void>;

  constructor(
    private readonly canvasHost: HTMLElement,
    private readonly store: TableStoreApi,
    private readonly assets: Pick<AssetLoader, 'load'>,
    private readonly lowPower: boolean,
    private readonly onGesture: (g: Gesture) => void = () => undefined,
  ) {
    this.ready = this.start();
  }

  /** Resolves once the renderer is up (or the view was destroyed meanwhile). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private async start(): Promise<void> {
    const { app, canvasHost, lowPower } = this;
    await app.init({
      preference: 'webgl', resizeTo: canvasHost, backgroundColor: CLEAR_COLOUR, antialias: !lowPower,
      resolution: lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
      accessibilityOptions: { activateOnTab: false },
    });
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    if (lowPower) app.ticker.maxFPS = 30;
    this.maxTexture = maxTextureSize(app);
    canvasHost.appendChild(app.canvas);
    const viewport = new Viewport({ screenWidth: app.screen.width, screenHeight: app.screen.height, worldWidth: 1, worldHeight: 1, events: app.renderer.events, ticker: app.ticker });
    viewport.drag({ mouseButtons: 'left' }).pinch().wheel().clampZoom({ minScale: MIN_ZOOM, maxScale: MAX_ZOOM });
    if (!lowPower) viewport.decelerate();
    viewport.addChild(this.map.layer, this.layers.annotations, this.layers.pins, this.layers.tokens, this.fogSlot);
    app.stage.addChild(viewport);
    app.renderer.on('resize', (width: number, height: number) => {
      viewport.resize(width, height, viewport.worldWidth, viewport.worldHeight);
      if (this.map.worldRect) this.applyZoomRange(this.map.worldRect);
    });
    this.viewport = viewport;
    this.input = new CanvasInput({
      host: canvasHost, canvas: app.canvas, now: () => performance.now(),
      tokenAt: (x, y) => this.tokenAt(x, y), isMine: (id) => this.store.getState().mine.has(id),
      onGesture: (g) => this.gesture(g), setCameraDrag: (on) => { if (on) viewport.plugins.resume('drag'); else viewport.plugins.pause('drag'); },
    });
    this.unsubscribe = this.store.subscribe((state) => this.sync(state));
    this.sync(this.store.getState());
  }

  private gesture(g: Gesture): void {
    if (g.kind === 'tap') this.store.select(this.tokenAt(g.x, g.y));
    this.onGesture(g);
  }

  /** The topmost token at a screen point; none under fog or before the fog is known. */
  private tokenAt(x: number, y: number): string | null {
    const { viewport } = this;
    const { mode, tokens, fog } = this.store.getState();
    if (!viewport || mode !== 'map' || fog === undefined) return null;
    const point = viewport.toWorld(x, y);
    const covered = this.coverage(fog);
    if (covered === null) return null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i]!;
      if (Math.hypot(point.x - token.x, point.y - token.y) > token.size / 2) continue;
      if (covered.covers({ x: token.x, y: token.y })) continue;
      return token.id;
    }
    return null;
  }

  /** The fog's coverage, kept while the fog is the same; null when it cannot be worked out (nothing is hit). */
  private coverage(fog: SharedFog): ReturnType<typeof fogCoverage> | null {
    if (this.coverageOf?.fog !== fog) {
      try {
        this.coverageOf = { fog, value: fogCoverage(sharedFogOperations(fog)) };
      } catch {
        return null;
      }
    }
    return this.coverageOf.value;
  }

  private sync(state: TableState): void {
    if (this.destroyed || !this.viewport) return;
    const key = state.mode === 'map' && state.scene ? `${state.scene.id}:${state.scene.map?.hash ?? ''}` : null;
    if (key !== this.sceneKey) {
      this.teardown();
      this.sceneKey = key;
      const request = mapRequest(state, this.lowPower, this.maxTexture);
      if (request) void this.assets.load(request.ref, request.maxSide).then((asset) => this.loadedMap(key, asset));
    }
    this.drawLayers(state);
  }

  private async loadedMap(key: string | null, asset: LoadedAsset | null): Promise<void> {
    if (asset === null || key !== this.sceneKey || this.destroyed) return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([asset.bytes as BlobPart], { type: asset.mime }));
    } catch {
      return;
    }
    if (key !== this.sceneKey || this.destroyed || !this.viewport) {
      bitmap.close();
      return;
    }
    const world = asset.width !== null && asset.height !== null ? { width: asset.width, height: asset.height } : null;
    this.map.show(bitmap, world);
    const rect = this.map.worldRect!;
    this.viewport.resize(this.viewport.screenWidth, this.viewport.screenHeight, rect.width, rect.height);
    this.applyZoomRange(rect);
    this.viewport.fit(true, rect.width, rect.height);
    this.viewport.moveCenter(rect.width / 2, rect.height / 2);
    this.loaded = true;
    this.drawLayers(this.store.getState());
  }

  /** The camera can always zoom out far enough to show the whole map, however large its world. */
  private applyZoomRange(rect: { width: number; height: number }): void {
    const { viewport } = this;
    if (!viewport) return;
    const fitScale = Math.min(viewport.screenWidth / rect.width, viewport.screenHeight / rect.height);
    viewport.clampZoom({ minScale: Math.min(MIN_ZOOM, fitScale), maxScale: MAX_ZOOM });
  }

  /** Grid and fog follow the store; the map and grid show only once the fog is known. */
  private drawLayers(state: TableState): void {
    const known = this.loaded && state.mode === 'map' && state.fog !== undefined;
    this.map.layer.visible = known;
    if (!known) {
      this.dropFogAndGrid();
      return;
    }
    const rect = this.map.worldRect!;
    if (state.fog !== this.shownFog || this.fog === null) {
      this.fog ??= this.makeFog(rect);
      this.fog.set(state.fog!);
      this.shownFog = state.fog;
    }
    if (state.grid === null) {
      this.grid?.destroy();
      this.grid = null;
      this.shownGrid = null;
    } else if (state.grid !== this.shownGrid) {
      if (this.grid) this.grid.updateOptions(gridOptions(state.grid));
      else if (this.viewport) this.grid = new GridSystem(this.app, this.viewport, this.map, gridOptions(state.grid));
      this.shownGrid = state.grid;
    }
  }

  private makeFog(rect: { x: number; y: number; width: number; height: number }): FogLayer {
    const fog = new FogLayer(rect);
    this.fogSlot.addChild(fog.sprite);
    return fog;
  }

  private dropFogAndGrid(): void {
    this.grid?.destroy();
    this.grid = null;
    this.shownGrid = null;
    this.fog?.destroy();
    this.fog = null;
    this.shownFog = undefined;
  }

  /** Forgets the picture of the scene shown: map, grid and fog. */
  private teardown(): void {
    this.dropFogAndGrid();
    this.map.clear();
    this.map.layer.visible = false;
    this.loaded = false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe?.();
    this.input?.destroy();
    this.dropFogAndGrid();
    if (this.viewport) {
      this.map.destroy();
      this.viewport.destroy({ children: true });
      this.app.destroy({ removeView: true }, { children: true });
    }
  }
}
