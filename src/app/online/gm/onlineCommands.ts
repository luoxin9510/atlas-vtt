import { t } from '../../i18n';
/** Online play's commands. Each is offered only while online play is switched on and has something to do. */
export const ONLINE_COMMANDS = [
  { id: 'start-online-table', name: t('onlineGm.command.start') },
  { id: 'toggle-online-panel', name: t('onlineGm.command.toggle') },
  { id: 'copy-online-table-link', name: t('onlineGm.command.copyLink') },
  { id: 'make-selected-player-tokens', name: t('onlineGm.command.playerTokens') },
  { id: 'make-selected-gm-tokens', name: t('onlineGm.command.gmTokens') },
  { id: 'stop-online-table', name: t('onlineGm.command.stop') },
] as const;

export type OnlineCommandId = (typeof ONLINE_COMMANDS)[number]['id'];
