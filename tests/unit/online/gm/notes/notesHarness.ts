import type { GmMessage, NotesMessage } from '../../../../../src/app/online/protocol/index.ts';
import { NotesShare, type NotesSharePorts } from '../../../../../src/app/online/gm/notes/NotesShare.ts';
import { readVaultImage } from '../../../../../src/app/online/gm/vaultImage.ts';
import { QuestImages } from '../../../../../src/app/plugin/questImages';
import { randomHex } from '../../../../../src/app/utils/randomHex';
import { questVault, type QuestVault } from '../../../../mocks/questVault';
import type { Timers } from '../../../../../src/app/online/gm/companionTimers.ts';
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

export function makeTable(files: Record<string, string>, extra: Partial<NotesSharePorts> = {}): Table {
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
    timers: clock(),
    ...extra,
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
  const request = (from: string, hash: string): void => {
    const body = { t: 'asset-request', hash };
    // The table's chain: the other shares read it first, then the notes refuse what they held.
    if (!share.receive(from, body)) share.refuseGone(from, body);
  };
  return { vault, share, sent, dropped, levels, lists, list, text, request };
}

/** Starts the share and lets every copy finish. */
export async function started(files: Record<string, string>, extra: Partial<NotesSharePorts> = {}): Promise<Table> {
  const table = makeTable(files, extra);
  table.share.start();
  await settled();
  table.share.resend();
  return table;
}

/**
 * Makes the vault's reads wait: each read takes the note's text at the moment it is asked and hands it
 * back when released, so builds can be finished in any order.
 */
export function holdReads(table: Table): { release(index?: number): Promise<void>; readonly waiting: number } {
  const { vault } = table.vault.app;
  const read = vault.read.bind(vault);
  const held: Array<() => void> = [];
  vault.read = (file) => {
    const content = read(file);
    return new Promise((resolve, reject) => void held.push(() => void content.then(resolve, reject)));
  };
  return {
    get waiting() {
      return held.length;
    },
    release: async (index = 0) => {
      const [release] = held.splice(index, 1);
      release?.();
      await settled();
    },
  };
}

/** Timers that run only when advanced, like the clock of the send queue tests. */
export function clock(): Timers & { advance(ms: number): void; readonly pending: number } {
  let now = 0;
  let timers: Array<{ at: number; run: () => void; id: number }> = [];
  let ids = 0;
  return {
    now: () => now,
    setTimer: (run, ms) => (timers.push({ at: now + ms, run, id: (ids += 1) }), ids),
    clearTimer: (id) => void (timers = timers.filter((timer) => timer.id !== id)),
    get pending() {
      return timers.length;
    },
    advance: (ms) => {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        now = next.at;
        timers = timers.filter((timer) => timer !== next);
        next.run();
      }
      now = end;
    },
  };
}
