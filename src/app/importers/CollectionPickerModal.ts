import { FuzzySuggestModal, type App } from 'obsidian';
import { t } from '../i18n';

export interface CollectionOption {
  id: string;
  name: string;
}

/** Asks which collection to use, typed to find one; resolves once with its id, or null when dismissed. */
class CollectionPickerModal extends FuzzySuggestModal<CollectionOption> {
  private chosen: string | null = null;

  constructor(app: App, private readonly options: readonly CollectionOption[], private readonly done: (id: string | null) => void) {
    super(app);
    this.setPlaceholder(t('importers.chooseCollection'));
    this.modalEl.addClass('atlas-vtt-plugin');
  }

  getItems(): CollectionOption[] {
    return [...this.options];
  }

  getItemText(option: CollectionOption): string {
    return option.name;
  }

  onChooseItem(option: CollectionOption): void {
    this.chosen = option.id;
  }

  onClose(): void {
    super.onClose();
    // Obsidian closes the modal before it hands over the choice; the choice is read a tick later.
    window.setTimeout(() => this.done(this.chosen), 0);
  }
}

/** The collection chosen among `options` (the first is the one offered first), or null. */
export function pickCollection(app: App, options: readonly CollectionOption[]): Promise<string | null> {
  return new Promise((resolve) => new CollectionPickerModal(app, options, resolve).open());
}
