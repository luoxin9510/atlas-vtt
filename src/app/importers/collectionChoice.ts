/**
 * Which collection an import goes into: the only one, else the person's choice with the open map's
 * collection offered first. With none, the import says so instead of ending without a word.
 */

import { t } from '../i18n';
import type { CollectionOption } from './CollectionPickerModal';

export interface CollectionChoice {
  collections: readonly CollectionOption[];
  /** The collection of the open map; offered first. */
  preferred: string | null;
  pick: (options: readonly CollectionOption[]) => Promise<string | null>;
  notify: (message: string) => void;
}

/** The collection to import into; null when there is none or the person dismisses the picker. */
export async function chooseImportCollection({ collections, preferred, pick, notify }: CollectionChoice): Promise<string | null> {
  const [first] = collections;
  if (first === undefined) {
    notify(t('importers.noCollection'));
    return null;
  }
  if (collections.length === 1) return first.id;
  const options = collections.map(({ id, name }) => ({ id, name: name || id }));
  options.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  return pick(options);
}
