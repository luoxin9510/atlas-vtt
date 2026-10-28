import type { Application } from 'pixi.js';
import { UPDATE_PRIORITY } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { DEFAULT_LIGHTING_QUALITY, LIGHTING_QUALITY, type LightingQualitySource } from '../../../../src/app/lighting/lightingQuality.ts';
import type { AssetRef } from '../../../../src/app/online/protocol/index.ts';
import { contextLost } from '../../../../src/app/pixi/lighting/engine/gpu.ts';
import type { LightingAttempt } from '../../../../src/app/pixi/lighting/lightingAttempts.ts';
import { LightingRenderer } from '../../../../src/app/pixi/lighting/LightingRenderer.ts';
import { SensedOutlines } from '../../../../src/app/pixi/token-renderer/SensedOutlines.ts';
import type { SightRules } from '../../../../src/app/vision/sightRules.ts';
import type { MapBounds } from '../../../../src/app/vision/visibility.ts';
import type { AssetLoader } from '../assets/AssetLoader.ts';
import { LightingInputs } from '../lighting/lightingInputs.ts';
import { createLightingStore, type PlayLightingStore } from '../lighting/lightingStore.ts';
import { sightRulesOf } from '../lighting/sightRulesOf.ts';
import type { LitInputs, TableStoreApi } from '../state/tableStore.ts';
import { DoorBadges } from './doorBadges.ts';
import { dataUrlOfPng } from './pngDataUrl.ts';

/** Low-power mode lights at the saver quality; otherwise the default. The quality never changes during a session. */
export function lightingQualityFor(lowPower: boolean): LightingQualitySource {
  const quality = lowPower ? LIGHTING_QUALITY.saver : DEFAULT_LIGHTING_QUALITY;
  return { current: () => quality, onChange: () => () => undefined };
}

/** A token with no known senses sees nothing: what stands in until the first sight message is read. */
const BLIND_RULES: SightRules = { definitions: [], conditions: [], visionOf: () => ({ senses: [], pending: true }) };

export interface LitSceneDeps {
  viewport: Viewport;
  app: Application;
  store: TableStoreApi;
  assets: Pick<AssetLoader, 'load'>;
  map: () => { bounds: MapBounds | null };
  quality: LightingQualitySource;
  attempt: LightingAttempt;
  /** The lighting cannot go on: the engine gave up, the attempt never finished or the context was lost. */
  onUnavailable(): void;
}

/**
 * One lit scene's lighting in the player's app: the shared `LightingRenderer` in player mode,
 * fed from the GM's `lighting`, `sight` and `explored` messages, with the sensed outlines and
 * door badges above it. `ready` is true only while the engine has drawn the current sight of the
 * messages over a map it has a world for; the owner shows no map pixel before that and none after
 * it turns false, and any failure ends the scene's lighting for good.
 */
export class LitScene {
  private readonly lighting: PlayLightingStore = createLightingStore();
  private readonly inputs = new LightingInputs();
  private readonly outlines = new SensedOutlines();
  private readonly doors = new DoorBadges();
  private renderer: LightingRenderer | null = null;
  private rules: SightRules | null = null;
  private applied: Pick<LitInputs, 'lighting' | 'sight'> | null = null;
  private exploredRef: AssetRef | null = null;
  private exploredUrl: string | null = null;
  private sensedShown: LitInputs['sensed'] | null = null;
  private failed = false;
  private destroyed = false;
  private readonly unsubscribe: () => void;
  private readonly onContextLost = (): void => this.fail();
  private readonly gate = (): void => this.showOverlays();

  constructor(private readonly deps: LitSceneDeps) {
    const { viewport, app, store } = deps;
    this.outlines.view.visible = false;
    this.doors.container.visible = false;
    viewport.addChild(this.outlines.view, this.doors.container);
    app.renderer.canvas.addEventListener('webglcontextlost', this.onContextLost);
    app.ticker.add(this.gate, undefined, UPDATE_PRIORITY.HIGH);
    this.unsubscribe = store.subscribe(() => this.follow());
    this.follow();
  }

  /** Sight current, over a map the engine has a world for, from the messages as they stand now. */
  get ready(): boolean {
    const { renderer } = this;
    if (this.failed || this.destroyed || renderer === null || contextLost(this.deps.app.renderer)) return false;
    const { lit } = this.deps.store.getState();
    if (lit.lighting === null || lit.sight === null || this.applied?.lighting !== lit.lighting || this.applied.sight !== lit.sight) return false;
    return renderer.isEnabled() && renderer.sightIsCurrent() && renderer.hasWorld();
  }

  /** Takes in the store's current messages at once (the owner asks before it decides what to draw). */
  refresh(): void {
    this.follow();
  }

  /** The map image arrived or went: the engine reads its size again. */
  mapChanged(): void {
    this.renderer?.refreshBounds();
    this.follow();
  }

  private follow(): void {
    if (this.failed || this.destroyed) return;
    const { lit } = this.deps.store.getState();
    this.followExplored(lit.explored);
    this.showOverlays();
    const bounds = this.deps.map().bounds;
    if (lit.lighting === null || lit.sight === null || bounds === null) return;
    if (this.applied?.lighting === lit.lighting && this.applied.sight === lit.sight) return;
    this.apply(lit.lighting, lit.sight, bounds);
  }

  private apply(lighting: NonNullable<LitInputs['lighting']>, sight: NonNullable<LitInputs['sight']>, bounds: MapBounds): void {
    this.rules = sightRulesOf(lighting, sight);
    this.applied = { lighting, sight };
    this.lighting.apply(this.inputs.update(lighting, sight, bounds), this.exploredUrl);
    if (this.renderer !== null) return;
    const made = this.makeRenderer();
    // The owner may have dropped this scene, or the renderer given up, while it was being made.
    if (this.destroyed || this.failed) made.destroy();
    else this.renderer = made;
  }

  private makeRenderer(): LightingRenderer {
    const { viewport, app, map, quality, attempt } = this.deps;
    const renderer = new LightingRenderer({
      viewport, app, store: this.lighting,
      measurement: () => this.inputs.measurement(),
      bounds: () => map().bounds,
      albedo: () => null,
      rules: () => this.rules ?? BLIND_RULES,
      attempt, quality,
      onUnavailable: () => this.fail(),
    });
    // The players' picture: what no token sees is dark, not ghosted.
    renderer.modeLayer.visible = true;
    return renderer;
  }

  /** The remembered-areas mask: a PNG fetched once per reference, handed over as a data URL. */
  private followExplored(ref: AssetRef | null): void {
    if (ref?.hash === this.exploredRef?.hash) return;
    this.exploredRef = ref;
    if (ref === null) {
      this.setExplored(null);
      return;
    }
    // The old mask may hold areas the GM has erased: show none while the new one loads.
    this.setExplored(null);
    void this.deps.assets.load(ref, null).then((asset) => {
      if (this.exploredRef !== ref || this.failed || this.destroyed) return;
      this.setExplored(asset === null ? null : dataUrlOfPng(asset.bytes));
    }, () => {
      if (this.exploredRef === ref) this.setExplored(null);
    });
  }

  private setExplored(url: string | null): void {
    this.exploredUrl = url;
    const { applied } = this;
    const bounds = this.deps.map().bounds;
    if (applied?.lighting && applied.sight && bounds) this.lighting.apply(this.inputs.update(applied.lighting, applied.sight, bounds), url);
  }

  /** The lighting's layer, the outlines and the badges show only while the lighting is ready (they belong to the same sight). */
  private showOverlays(): void {
    const ready = this.ready;
    if (this.renderer) this.renderer.layer.visible = ready;
    const { lit, cell } = this.deps.store.getState();
    this.outlines.view.visible = ready;
    this.doors.container.visible = ready;
    if (!ready) return;
    if (this.sensedShown !== lit.sensed) {
      this.sensedShown = lit.sensed;
      this.outlines.sync(lit.sensed.map((mark, index) => ({ id: `sensed-${index}`, x: mark.x, y: mark.y, size: mark.size })));
    }
    this.doors.sync(lit.doors, lit.lighting?.cellSize ?? cell);
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    if (this.renderer) this.renderer.layer.visible = false;
    this.outlines.view.visible = false;
    this.doors.container.visible = false;
    this.deps.onUnavailable();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.deps.app.ticker.remove(this.gate);
    this.deps.app.renderer.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer?.destroy();
    this.renderer = null;
    this.outlines.view.destroy({ children: true });
    this.doors.destroy();
  }
}
