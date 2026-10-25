import { MAX_LIGHT_ZONES } from '../../lighting/lightZones';
import { showNotice } from '../../ui/notice';
import { t } from '../../i18n';

/**
 * Tells the GM that this map is drawn without dynamic lighting; `canRetry` when the engine was
 * held back because its last start never finished, which switching lighting off and on overrides.
 */
export function showLightingUnavailableNotice(canRetry: boolean): void {
  const retry = canRetry ? t('light.notice.retry') : '';
  showNotice(t('light.notice.unavailable', { retry }), 15000);
}

/** Tells the GM that undo or redo changed the explored memory, when the canvas does not show it. */
export function showExploredTravelNotice(undone: boolean): void {
  showNotice(undone ? t('light.notice.undidExplored') : t('light.notice.redidExplored'));
}

/** Tells the GM that the map holds as many light zones as it may, when another is begun. */
export function showZonesFullNotice(): void {
  showNotice(t('light.notice.zonesFull', { count: MAX_LIGHT_ZONES }));
}
