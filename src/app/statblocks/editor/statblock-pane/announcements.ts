import { Platform } from 'obsidian';
import { t } from '../../../i18n';

/** What the pane says after taking something out of the note: what went, and how to get it back. */
export function removedMessage(what: string, verb: 'Deleted' | 'Removed' = 'Deleted'): string {
  const keys = Platform.isMacOS ? 'Cmd+Z' : 'Ctrl+Z';
  return t(verb === 'Removed' ? 'sbEditorPane.removedUndo' : 'sbEditorPane.deletedUndo', { what, keys });
}
