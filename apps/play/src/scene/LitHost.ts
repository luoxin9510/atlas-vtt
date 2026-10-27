import type { Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { MapBounds } from '../../../../src/app/vision/visibility.ts';
import type { AssetLoader } from '../assets/AssetLoader.ts';
import { browserStorage } from '../browserStorage.ts';
import { storedLightingAttempt } from '../lighting/storedAttempt.ts';
import type { TableState, TableStoreApi } from '../state/tableStore.ts';
import { orderLayers, type SceneLayers } from './layerOrder.ts';
import { LitScene, lightingQualityFor } from './LitScene.ts';

export interface LitHostDeps {
  app: Application;
  store: TableStoreApi;
  assets: Pick<AssetLoader, 'load'>;
  lowPower: boolean;
  layers: SceneLayers;
  /** The map's size in world px while it is shown: one object, since the lighting compares it by reference. */
  bounds: () => MapBounds | null;
}

/**
 * Keeps a `LitScene` for as long as the store says the scene is lit and this device can light it,
 * and the viewport's layers in the order that scene needs. Any failure of the lighting turns the
 * store's verdict into `'unsupported'` for the session, which drops the scene again.
 */
export class LitHost {
  private scene: LitScene | null = null;

  constructor(private readonly deps: LitHostDeps) {}

  /** The lighting has drawn the current sight over the map. */
  get ready(): boolean {
    return this.scene?.ready === true;
  }

  follow(state: TableState, viewport: Viewport | null): void {
    if (state.mode !== 'lit' || viewport === null) {
      this.drop();
      return;
    }
    if (this.scene !== null) return;
    const { app, store, assets, lowPower, layers, bounds } = this.deps;
    orderLayers(true, layers);
    this.scene = new LitScene({
      viewport, app, store, assets,
      map: () => ({ bounds: bounds() }),
      quality: lightingQualityFor(lowPower),
      attempt: storedLightingAttempt(browserStorage()),
      onUnavailable: () => store.setLighting('unsupported'),
    });
    // The engine may have given up while it was being made: the store then says placeholder.
    if (store.getState().mode !== 'lit') this.drop();
  }

  /** The map image arrived or went. */
  mapChanged(): void {
    this.scene?.mapChanged();
  }

  drop(): void {
    if (this.scene === null) return;
    const scene = this.scene;
    this.scene = null;
    scene.destroy();
    orderLayers(false, this.deps.layers);
  }
}
