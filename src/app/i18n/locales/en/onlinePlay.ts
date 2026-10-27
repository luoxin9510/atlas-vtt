import type { Message } from '../../types';

export const onlinePlay = {
  'onlinePlay.app.title': 'Atlas online table',
  'onlinePlay.legal.source': 'Source',
  'onlinePlay.legal.licence': 'Licence (AGPL-3.0)',
  'onlinePlay.lit.placeholder': 'This scene needs dynamic lighting (coming next)',
} as const satisfies Record<string, Message>;
