import { createDialogShell } from './dialogShell';
import { t } from '../i18n';

export interface TextInputDialogOptions {
  title: string;
  confirmLabel: string;
  initialValue?: string;
  placeholder?: string;
  /** One line (an `input`) instead of a box for several. */
  singleLine?: boolean;
  /**
   * Checks the trimmed text, empty included, when it is confirmed: a message keeps the dialog open
   * and is shown in it, null accepts.
   */
  validate?: (text: string) => string | null;
}

/**
 * Small centred dialog with a textarea. Resolves with the trimmed text, or
 * `null` when cancelled or left empty. Enter confirms, Shift+Enter adds a line.
 */
export function promptForText(options: TextInputDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const { root, dialog } = createDialogShell(options.title);

    const textarea: HTMLInputElement | HTMLTextAreaElement = options.singleLine
      ? dialog.createEl('input', { cls: 'atlas-text-dialog__input atlas-text-dialog__input--line', type: 'text' })
      : dialog.createEl('textarea', { cls: 'atlas-text-dialog__input' });
    textarea.value = options.initialValue ?? '';
    if (options.placeholder) textarea.placeholder = options.placeholder;

    const problem = dialog.createDiv({ cls: 'atlas-text-dialog__error', attr: { role: 'alert' } });
    const actions = dialog.createDiv({ cls: 'atlas-text-dialog__actions' });
    const cancelButton = actions.createEl('button', { text: t('common.cancel') });
    const confirmButton = actions.createEl('button', { cls: 'mod-cta', text: options.confirmLabel });

    const close = (result: string | null): void => {
      root.remove();
      resolve(result);
    };
    const confirm = (): void => {
      const text = textarea.value.trim();
      const message = options.validate?.(text) ?? null;
      problem.textContent = message ?? '';
      if (message === null) close(text || null);
    };

    confirmButton.addEventListener('click', confirm);
    cancelButton.addEventListener('click', () => close(null));
    root.addEventListener('click', (event) => {
      if (event.target === root) close(null);
    });
    const keyTarget: HTMLElement = textarea;
    keyTarget.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        confirm();
      } else if (event.key === 'Escape') {
        close(null);
      }
    });

    textarea.focus();
    textarea.select();
  });
}
