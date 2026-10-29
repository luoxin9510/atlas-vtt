import type { NotesMessage } from '../../protocol/fork.ts';
import type { Entry } from './sharedNotes.ts';

/** The copies in the order they are listed. */
export type Listed = ReadonlyArray<{ readonly path: string; readonly entry: Entry }>;

/** The list players are sent. */
export function listMessage(listed: Listed): NotesMessage {
  return {
    t: 'notes',
    notes: listed.map(({ entry }) => ({
      id: entry.id, title: entry.title, ...(entry.group === null ? {} : { group: entry.group }), text: entry.ref,
    })),
  };
}

/** The bytes of the copy with this hash. */
export function textBytes(listed: Listed, hash: string): Uint8Array | undefined {
  return listed.find(({ entry }) => entry.ref.hash === hash)?.entry.bytes;
}

/** The vault path of the image with this hash, in any copy. */
export function imagePath(listed: Listed, hash: string): string | undefined {
  for (const { entry } of listed) {
    const path = entry.images.get(hash);
    if (path !== undefined) return path;
  }
  return undefined;
}
