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
  assets: Pick<AssetLoader, 'load' | 'cancel'>;
  lowPower: boolean;
}

/** The scene: the Pixi view, with the placeholder over it for a lit scene until its lighting is drawn (or for good where it cannot be). */
export function SceneCanvas({ store, assets, lowPower }: SceneCanvasProps): ReactElement | null {
  const mode = useStore(store, (state) => state.mode);
  const lighting = useStore(store, (state) => state.lighting);
  const tokens = useStore(store, (state) => state.tokens);
  // Whether the view has drawn the scene; a lit scene's map is not drawn before its lighting is.
  const [drawn, setDrawn] = useState(false);
  const present = mode !== 'none';
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
    if (!present || element === null) return undefined;
    const view = new SceneView(element, store, assets, lowPower, onGesture, setDrawn);
    return () => { view.destroy(); setCardId(null); setDrawn(false); };
  }, [present, store, assets, lowPower, onGesture]);
  if (mode === 'none') return null;
  const card = cardId === null ? undefined : tokens.find((token) => token.id === cardId);
  return (
    <div className="atlas-play-stage">
      <div ref={host} className="atlas-play-scene" />
      {mode === 'placeholder' || (mode === 'lit' && !drawn) ? <LitPlaceholder unsupported={lighting === 'unsupported'} /> : null}
      {card ? <TokenCard token={card} onClose={() => { setCardId(null); store.select(null); }} /> : null}
    </div>
  );
}
