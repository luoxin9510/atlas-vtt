// Pixi must not use eval (the relay's CSP forbids it): this entry point swaps the shader and uniform-sync
// code generators for ones without it. It is imported once, here, before any renderer is made.
import 'pixi.js/unsafe-eval';
import { Application, Container, UPDATE_PRIORITY } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { MapBounds } from '../../../../src/app/vision/visibility.ts';
import { GridSystem } from '../../../../src/app/grid/GridSystem.ts';
import type { SharedFog } from '../../../../src/app/online/protocol/fog.ts';
import type { SharedGrid } from '../../../../src/app/online/protocol/mapLayers.ts';
import type { AssetLoader, LoadedAsset } from '../assets/AssetLoader.ts';
import { canRunLighting } from '../lighting/lightingProbe.ts';
import type { TableState, TableStoreApi } from '../state/tableStore.ts';
import { CanvasInput } from './canvasInput.ts';
import { CoverageMemo } from './coverageMemo.ts';
import { AnnotationLayer } from './annotationLayer.ts';
import { FogLayer } from './fogLayer.ts';
import { orderLayers } from './layerOrder.ts';
import { LitHost } from './LitHost.ts';
import type { Gesture } from './gestures.ts';
import { coarsePointer } from './lowPower.ts';
import { MapDownload } from './MapDownload.ts';
import { mapRequest } from './mapRequest.ts';
import { MapSprite } from './mapSprite.ts';
import { PinLayer } from './PinLayer.ts';
import { gridOptions, maxTextureSize } from './sceneHelpers.ts';
import { TokenLayer } from './TokenLayer.ts';

export { mapRequest } from './mapRequest.ts';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const CLEAR_COLOUR = 0x1b1b1f;

/**
 * The player's picture of the table: the map, its grid, fog and camera, drawn only from what the GM
 * sent. Unlit layers from the bottom: map, grid, annotations, pins, tokens, fog (so fog covers
 * tokens); a lit scene's order is in `layerOrder.ts`. Nothing of a scene is requested or drawn
 * unless the store says it is an unlit scene or a lit one this device can light, and the map
 * stays hidden until the fog has been received and, for a lit scene, until the lighting engine
 * has drawn the current sight over it (`LitScene.ready`). Any failure of the lighting ends the
 * lit scene for the session: the store turns it into the placeholder and nothing is drawn.
 */
export class SceneView {
  readonly app = new Application();
  /** Containers of the annotations, pins and tokens; they sit between the grid and the fog. */
  readonly layers = { annotations: new Container({ label: 'annotations' }), pins: new Container({ label: 'pins' }), tokens: new Container({ label: 'tokens' }) };
  private readonly map = new MapSprite();
  private readonly tokenLayer: TokenLayer;
  private readonly pinLayer = new PinLayer();
  private readonly annotationLayer: AnnotationLayer;
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
  private readonly coverage = new CoverageMemo();
  private maxTexture = 4096;
  private readonly lit: LitHost;
  /** The map's size in world px while it is shown: one object, since the lighting compares it by reference. */
  private bounds: MapBounds | null = null;
  /** Whether the last `drawLayers` drew the scene (the map shown). */
  private drawn = false;
  private destroyed = false;
  private readonly download: MapDownload;
  private readonly ready: Promise<void>;

  constructor(
    private readonly canvasHost: HTMLElement,
    private readonly store: TableStoreApi,
    private readonly assets: Pick<AssetLoader, 'load' | 'cancel'>,
    private readonly lowPower: boolean,
    private readonly onGesture: (g: Gesture) => void = () => undefined,
    private readonly onDrawn: (drawn: boolean) => void = () => undefined,
  ) {
    this.tokenLayer = new TokenLayer(assets, lowPower);
    this.download = new MapDownload({
      assets,
      arrived: (key, asset) => void this.loadedMap(key, asset),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
    });
    this.annotationLayer = new AnnotationLayer(this.layers.annotations);
    this.lit = new LitHost({ app: this.app, store, assets, lowPower, layers: { map: this.map.layer, ...this.layers, fog: this.fogSlot }, bounds: () => this.bounds });
    this.layers.pins.addChild(this.pinLayer.container);
    this.layers.tokens.addChild(this.tokenLayer.container);
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
    viewport.sortableChildren = true;
    viewport.addChild(this.map.layer, this.layers.annotations, this.layers.pins, this.layers.tokens, this.fogSlot);
    orderLayers(false, { map: this.map.layer, ...this.layers, fog: this.fogSlot });
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
    // Before every render: a lit scene that stopped being ready (a lost context, sight rebuilt) is hidden before it is drawn.
    app.ticker.add(this.gate, undefined, UPDATE_PRIORITY.HIGH);
    this.sync(this.store.getState());
  }

  private gesture(g: Gesture): void {
    if (g.kind === 'tap' || g.kind === 'long-press') this.store.select(this.tokenAt(g.x, g.y));
    this.onGesture(g);
  }

  /** The topmost token at a screen point; none under fog or before the fog is known. */
  private tokenAt(x: number, y: number): string | null {
    const { viewport } = this;
    const { mode, fog } = this.store.getState();
    if (!viewport || (mode !== 'unlit' && mode !== 'lit') || fog === undefined || !this.drawn) return null;
    const point = viewport.toWorld(x, y);
    const covered = this.coverage.of(fog);
    if (covered === null) return null;
    return this.tokenLayer.tokenAt(point.x, point.y, (token) => !covered.covers({ x: token.x, y: token.y }));
  }

  private sync(state: TableState): void {
    if (this.destroyed || !this.viewport) return;
    if (state.lighting === 'unknown' && state.scene !== null && state.scene.lit !== false) {
      // The first lit scene asks whether this device can light it, once; the store turns the scene lit or keeps it a placeholder.
      this.store.setLighting(canRunLighting(this.app.renderer) ? 'ready' : 'unsupported');
      return;
    }
    const shown = state.mode === 'unlit' || state.mode === 'lit';
    const key = shown && state.scene ? `${state.scene.id}:${state.scene.map?.hash ?? ''}` : null;
    if (key !== this.sceneKey) {
      this.teardown();
      this.sceneKey = key;
    }
    this.lit.follow(state, this.viewport);
    const connected = state.status.kind === 'joined' && state.status.gmOnline;
    this.download.sync(key, mapRequest(state, this.lowPower, this.maxTexture, coarsePointer()), connected);
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
    this.bounds = { width: rect.width, height: rect.height };
    this.viewport.resize(this.viewport.screenWidth, this.viewport.screenHeight, rect.width, rect.height);
    this.applyZoomRange(rect);
    this.viewport.fit(true, rect.width, rect.height);
    this.viewport.moveCenter(rect.width / 2, rect.height / 2);
    this.loaded = true;
    this.lit.mapChanged();
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
    const known = this.shows(state);
    if (known !== this.drawn) this.onDrawn(known);
    this.drawn = known;
    this.map.layer.visible = known;
    if (!known) {
      this.dropFogAndGrid();
      this.clearLayers();
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
    this.annotationLayer.sync(state.annotations);
    this.pinLayer.sync(state.pins, state.cell);
    this.tokenLayer.sync(state.tokens, state.mine, state.selected, state.cell);
  }

  /** Whether the scene may be drawn: loaded, its fog known and, if lit, the lighting ready over it. */
  private shows(state: TableState): boolean {
    if (!this.loaded || state.fog === undefined) return false;
    if (state.mode === 'unlit') return true;
    return state.mode === 'lit' && this.lit.ready;
  }

  private readonly gate = (): void => {
    const state = this.store.getState();
    if (!this.destroyed && this.drawn !== this.shows(state)) this.drawLayers(state);
  };

  /** Nothing of the scene's annotations, pins or tokens stays drawn while its picture is not shown. */
  private clearLayers(): void {
    this.annotationLayer.sync({ drawings: [], texts: [] });
    this.pinLayer.sync([]);
    this.tokenLayer.sync([], new Set(), null);
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
    this.drawn = false;
    this.onDrawn(false);
    this.bounds = null;
    this.lit.mapChanged();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.download.stop();
    this.unsubscribe?.();
    if (this.viewport) this.app.ticker.remove(this.gate);
    this.lit.drop();
    this.input?.destroy();
    this.dropFogAndGrid();
    this.tokenLayer.destroy();
    this.pinLayer.destroy();
    this.annotationLayer.destroy();
    if (this.viewport) {
      this.map.destroy();
      this.viewport.destroy({ children: true });
      this.app.destroy({ removeView: true }, { children: true });
    }
  }
}
