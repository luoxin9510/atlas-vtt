import { showNotice } from '../ui/notice';
import { t } from '../i18n';


let shown = false;

/** Tells the user once per session that maps are drawn without the GPU, and how to get it back. */
export function showSoftwareRenderingNotice(): void {
  if (shown) return;
  shown = true;
  showNotice(t('notice.softwareRendering'), 15000);
}
