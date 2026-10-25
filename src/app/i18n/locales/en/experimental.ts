import type { Message } from '../../types';

export const experimental = {
  'experimental.statblockEditor.label': 'Statblock editor',
  'experimental.statblockEditor.hint': 'Statblock roles and templates: a collection\'s Statblocks settings, and editing statblocks in Atlas. While off, statblocks show as before.',
  'experimental.onlinePlay.label': 'Online play',
  'experimental.onlinePlay.hint': 'Host a table that players join from their browsers: the online control at the bottom left of a map, and the account settings. While off, Atlas connects to nothing.',
  'experimental.pageTitle': 'Experimental Features',
  'experimental.pageLabel': 'Experimental features',
  'experimental.dynamicLighting': 'Dynamic lighting',
} as const satisfies Record<string, Message>;
