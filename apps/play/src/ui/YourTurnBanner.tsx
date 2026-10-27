import { useEffect, useRef, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { t } from '../../../../src/app/i18n/index.ts';
import type { TableStoreApi } from '../state/tableStore.ts';

/** How long the banner stays when nobody taps it. */
export const BANNER_MS = 8000;

export interface YourTurnBannerProps {
  store: TableStoreApi;
  lowPower: boolean;
}

/** "Your turn!" while the store says so: tap to dismiss, gone after 8 s; buzzes once where the browser can and power is not short. */
export function YourTurnBanner({ store, lowPower }: YourTurnBannerProps): ReactElement | null {
  const at = useStore(store, (state) => state.yourTurnAt);
  const lowPowerRef = useRef(lowPower);
  lowPowerRef.current = lowPower;
  useEffect(() => {
    if (at === null) return undefined;
    if (!lowPowerRef.current) navigator.vibrate?.([200, 100, 200]);
    const timer = setTimeout(() => store.dismissYourTurn(), BANNER_MS);
    return () => clearTimeout(timer);
  }, [at, store]);
  if (at === null) return null;
  return (
    <button type="button" className="atlas-play-your-turn" role="alert" onClick={() => store.dismissYourTurn()}>
      {t('onlinePlay.turn.banner')}
    </button>
  );
}
