import { t } from '../../../i18n';

/**
 * Under a surface's header while the GM shares notes: how many players can read, and, when more notes
 * are flagged than the list holds, a line that the rest are not shared. Nothing shows while none are shared.
 */
export function renderNotesRow(layer: HTMLElement, count: number, capped: boolean): void {
  if (count <= 0 && !capped) return;
  const line = (text: string): void => {
    const row = layer.createDiv({ cls: 'atlas-online-image-row', attr: { role: 'status' } });
    row.createSpan({ cls: 'atlas-online-image-row__text', text });
  };
  line(t('onlineDock.notesShared', { count }));
  if (capped) line(t('onlineDock.notesCapped'));
}
