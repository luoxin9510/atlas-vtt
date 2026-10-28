import type { GmMessage, NotesMessage } from '../../../../../src/app/online/protocol/index.ts';
import { NotesShare } from '../../../../../src/app/online/gm/notes/NotesShare.ts';
import { readVaultImage } from '../../../../../src/app/online/gm/vaultImage.ts';
import { QuestImages } from '../../../../../src/app/plugin/questImages';
import { randomHex } from '../../../../../src/app/utils/randomHex';
import { questVault, type QuestVault } from '../../../../mocks/questVault';
import { settled } from '../settled.ts';

export const ANA = 'a'.repeat(20);
export const BEN = 'b'.repeat(20);
export const OLD = 'o'.repeat(20);

/** A GIF header: the smallest bytes players may be sent as an image, all of them one byte in UTF-8. */
export const gif = (tail: string): string => `GIF89a\u0001\u0000\u0001\u0000${tail}`;

export const shared = (body: string, extra = ''): string => `---\natlas-share: true\n${extra}---\n${body}`;

export interface Sent {
  readonly body: GmMessage;
  readonly to: string;
  readonly tag: string | undefined;
}

export interface Table {
  readonly vault: QuestVault;
  readonly share: NotesShare;
  readonly sent: Sent[];
  readonly dropped: string[];
  readonly levels: Map<string, number>;
  lists(to?: string): NotesMessage[];
  list(): NotesMessage['notes'];
  text(id: string): Promise<string>;
  request(from: string, hash: string): void;
}

export function makeTable(files: Record<string, string>): Table {
  const vault = questVault(files);
  const sent: Sent[] = [];
  const dropped: string[] = [];
  const levels = new Map<string, number>([[ANA, 3], [BEN, 2], [OLD, 0]]);
  let current: NotesMessage['notes'] = [];
  const share = new NotesShare({
    app: vault.app,
    players: () => [ANA, BEN, OLD],
    levelOf: (player) => levels.get(player) ?? 0,
    send: (body, to, tag) => {
      const copy = JSON.parse(JSON.stringify(body)) as GmMessage;
      if (copy.t === 'notes' && to === ANA) current = copy.notes;
      sent.push({ body: copy, to, tag });
    },
    dropTagged: (tag) => void dropped.push(tag),
    randomId: () => randomHex(12),
    now: () => Date.now(),
    images: new QuestImages(vault.app),
    readImage: (path) => readVaultImage(vault.app, path),
  });
  const lists = (to?: string): NotesMessage[] => sent.flatMap((entry) => (entry.body.t === 'notes' && (to === undefined || entry.to === to) ? [entry.body] : []));
  const list = (): NotesMessage['notes'] => current;
  const text = async (id: string): Promise<string> => {
    const note = list().find((one) => one.id === id);
    if (note === undefined) throw new Error('not listed');
    sent.length = 0;
    // The same request again within seconds is ignored; a player who left may ask at once.
    share.playerLeft(ANA);
    share.receive(ANA, { t: 'asset-request', hash: note.text.hash });
    await settled();
    const chunks = sent.flatMap((entry) => (entry.body.t === 'asset-chunk' ? [entry.body] : []));
    return chunks.map((chunk) => Buffer.from(chunk.data, 'base64').toString('utf8')).join('').trim();
  };
  const request = (from: string, hash: string): void => void share.receive(from, { t: 'asset-request', hash });
  return { vault, share, sent, dropped, levels, lists, list, text, request };
}

/** Starts the share and lets every copy finish. */
export async function started(files: Record<string, string>): Promise<Table> {
  const table = makeTable(files);
  table.share.start();
  await settled();
  table.share.resend();
  return table;
}
