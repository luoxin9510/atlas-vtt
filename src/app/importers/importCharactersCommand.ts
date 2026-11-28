/**
 * The command "Import character file…". It is registered always, since a rule pack may register
 * its importer after Atlas loaded, but it is offered (and runs) only while an importer is.
 */

import type { Plugin } from 'obsidian';
import { t } from '../i18n';
import { importerIds } from './importerRegistry';

export function registerImportCharactersCommand(plugin: Pick<Plugin, 'addCommand'>, run: () => void): void {
  plugin.addCommand({
    id: 'import-character-file',
    name: t('importers.command'),
    checkCallback: (checking) => {
      if (importerIds().length === 0) return false;
      if (!checking) run();
      return true;
    },
  });
}
