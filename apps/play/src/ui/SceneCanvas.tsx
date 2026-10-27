import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useStore } from 'zustand';
import type { AssetLoader } from '../assets/AssetLoader.ts';
import type { Gesture } from '../scene/gestures.ts';
import { SceneView } from '../scene/SceneView.ts';
import type { TableStoreApi } from '../state/tableStore.ts';
import { LitPlaceholder } from './LitPlaceholder.tsx';
import { TokenCard } from './TokenCard.tsx';

export interface SceneCanvasProps {
  store: TableStoreApi;
  assets: Pick<AssetLoader, 'load'>;
  lowPower: boolean;
}

/** The scene: the Pixi view for an unlit scene, the placeholder for a lit one (no canvas is made for it). */
export function SceneCanvas({ store, assets, lowPower }: SceneCanvasProps): ReactElement | null {
  const mode = useStore(store, (state) => state.mode);
  const tokens = useStore(store, (state) => state.tokens);
  const host = useRef<HTMLDivElement>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  // A tap or long press has just selected the token under it (or none); the card is for an own token only.
  const onGesture = useCallback((gesture: Gesture): void => {
    if (gesture.kind !== 'tap' && gesture.kind !== 'long-press') return;
    const { selected, mine } = store.getState();
    setCardId(selected !== null && mine.has(selected) ? selected : null);
  }, [store]);
  useEffect(() => {
    const element = host.current;
    if (mode !== 'map' || element === null) return undefined;
    const view = new SceneView(element, store, assets, lowPower, onGesture);
    return () => { view.destroy(); setCardId(null); };
  }, [mode, store, assets, lowPower, onGesture]);
  if (mode === 'lit-placeholder') return <LitPlaceholder />;
  if (mode === 'none') return null;
  const card = cardId === null ? undefined : tokens.find((token) => token.id === cardId);
  return (
    <div className="atlas-play-stage">
      <div ref={host} className="atlas-play-scene" />
      {card ? <TokenCard token={card} onClose={() => { setCardId(null); store.select(null); }} /> : null}
    </div>
  );
}
