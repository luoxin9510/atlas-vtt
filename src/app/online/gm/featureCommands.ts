import type { App } from 'obsidian';
import { showNotice } from '../../ui/notice';
import { activeAtlasLeaf } from './atlasView.ts';
import { copyText } from './dock/dockDom.ts';
import type { DockMounts } from './dock/DockMounts.ts';
import type { OnlineCommandId } from './onlineCommands.ts';
import type { OnlineControl } from './OnlineControl.ts';
import type { OnlineTable } from './OnlineTable.ts';
import { t } from '../../i18n';

/** What online play's commands need of the feature. */
export interface CommandPorts {
  app: App;
  online: () => OnlineControl;
  docks: DockMounts;
  table: () => OnlineTable | null;
}

const tokensText = (count: number): string => t('onlineGm.tokens', { count });

/** Makes the tokens selected on the active Atlas tab player tokens, or the GM's own. */
function markSelected(ports: CommandPorts, checking: boolean, player: boolean): boolean {
  if (activeAtlasLeaf(ports.app) === null) return false;
  if (checking) return true;
  const count = ports.online().markSelected(player);
  if (count === null) return true;
  if (count === 0) showNotice(t('onlineGm.mark.selectFirst'));
  else showNotice(player ? t('onlineGm.mark.player', { tokens: tokensText(count) }) : t('onlineGm.mark.gm', { tokens: tokensText(count) }));
  return true;
}

/** What each of online play's commands does; the plugin registers the commands once (`registerOnlinePlay`). */
export function registerFeatureCommands(ports: CommandPorts): Map<OnlineCommandId, (checking: boolean) => boolean> {
  const commands = new Map<OnlineCommandId, (checking: boolean) => boolean>();
  const command = (id: OnlineCommandId, check: (checking: boolean) => boolean): void => {
    commands.set(id, check);
  };
  const { docks } = ports;
  command('start-online-table', (checking) => {
    const leaf = activeAtlasLeaf(ports.app);
    if (!ports.online().canStart() || leaf === null) return false;
    // Opens the start menu, where the GM picks the campaign the table plays.
    if (!checking) docks.dockOf(leaf)?.open();
    return true;
  });
  command('toggle-online-panel', (checking) => {
    const leaf = activeAtlasLeaf(ports.app);
    const dock = leaf === null ? undefined : docks.dockOf(leaf);
    if (dock === undefined) return false;
    if (!checking) dock.toggle(false);
    return true;
  });
  command('copy-online-table-link', (checking) => {
    const link = ports.online().link();
    if (link === null) return false;
    if (!checking) void copyText(activeDocument.body, link).then((copied) => showNotice(copied ? t('onlineGm.link.copied') : t('onlineGm.link.copyFailed')));
    return true;
  });
  command('make-selected-player-tokens', (checking) => markSelected(ports, checking, true));
  command('make-selected-gm-tokens', (checking) => markSelected(ports, checking, false));
  command('stop-online-table', (checking) => {
    if (ports.table() === null) return false;
    if (!checking) ports.online().stop();
    return true;
  });
  return commands;
}
