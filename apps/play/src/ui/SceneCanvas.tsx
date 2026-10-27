import { useEffect, useRef, type ReactElement } from 'react';
import { useStore } from 'zustand';
import type { AssetLoader } from '../assets/AssetLoader.ts';
import { SceneView } from '../scene/SceneView.ts';
import type { TableStoreApi } from '../state/tableStore.ts';
import { LitPlaceholder } from './LitPlaceholder.tsx';

export interface SceneCanvasProps {
  store: TableStoreApi;
  assets: Pick<AssetLoader, 'load'>;
  lowPower: boolean;
}

/** The scene: the Pixi view for an unlit scene, the placeholder for a lit one (no canvas is made for it). */
export function SceneCanvas({ store, assets, lowPower }: SceneCanvasProps): ReactElement | null {
  const mode = useStore(store, (state) => state.mode);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (mode !== 'map' || element === null) return undefined;
    const view = new SceneView(element, store, assets, lowPower);
    return () => view.destroy();
  }, [mode, store, assets, lowPower]);
  if (mode === 'lit-placeholder') return <LitPlaceholder />;
  if (mode === 'none') return null;
  return <div ref={host} className="atlas-play-scene" />;
}
