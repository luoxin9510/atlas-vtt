import type { Message } from '../../types';

/** Importing character files: the command, its dialogs and the summary. */
export const importers = {
  'importers.command': 'Import character file…',
  'importers.chooseCollection': 'Import into which collection?',
  'importers.alreadyTitle': 'Already imported',
  'importers.alreadyMessage': '“{name}” was imported from this file before. Re-import it?',
  'importers.reimport': 'Re-import',
  'importers.failed': 'Importing character files failed.',
  'importers.noImporter': 'No importer reads this kind of file.',
  'importers.count.imported': '{count} imported',
  'importers.count.updated': '{count} updated',
  'importers.count.skipped': '{count} skipped',
  'importers.count.failed': '{count} failed',
  'importers.line.failed': '{name}: {reason}',
  'importers.line.noPortrait': '{name}: the portrait is not PNG, JPG or WebP, so it was imported without a token.',
} as const satisfies Record<string, Message>;
