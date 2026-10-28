import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import { t } from '../../../../src/app/i18n/index.ts';
import type { TableStoreApi } from '../state/tableStore.ts';

/** "Game paused" while the GM has the table paused: a strip under the status bar, in the page flow, so it never covers the dice tray. */
export function PauseBanner({ store }: { store: TableStoreApi }): ReactElement | null {
  const paused = useStore(store, (state) => state.paused);
  if (!paused) return null;
  return <p className="atlas-play-paused" role="status">{t('onlinePlay.move.paused')}</p>;
}
