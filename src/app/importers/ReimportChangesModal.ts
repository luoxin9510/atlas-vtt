import { Modal, type App } from 'obsidian';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../ui/nativeModal';
import { t } from '../i18n';
import { changeText } from './importDiff';
import type { ReimportPreview } from './reimportCharacter';

/** Lists what a re-import will change; Re-import confirms, Cancel (or closing it) changes nothing. */
class ReimportChangesModal extends Modal {
  private confirmed = false;

  constructor(app: App, private readonly preview: ReimportPreview, private readonly done: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, preview } = this;
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES);
    this.setTitle(t('importers.changesTitle', { name: preview.name }));
    contentEl.createEl('p', { text: t('importers.changesIntro') });
    const list = contentEl.createEl('ul');
    for (const change of preview.changes) list.createEl('li', { text: changeText(change) });
    if (preview.portrait) list.createEl('li', { text: t('importers.changesPortrait') });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('importers.reimport'), cls: 'mod-cta' }).addEventListener('click', () => {
      this.confirmed = true;
      this.close();
    });
    buttons.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.confirmed);
  }
}

/** The changes shown for confirmation; resolves true only for Re-import. */
export function confirmChanges(app: App, preview: ReimportPreview): Promise<boolean> {
  return new Promise((resolve) => new ReimportChangesModal(app, preview, resolve).open());
}
