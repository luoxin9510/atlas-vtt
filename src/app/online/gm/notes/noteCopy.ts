import type { QuestImages } from '../../../plugin/questImages';
import { parseNote } from './parseNote';
import { copyForPlayers, type CopyTargets } from './playerCopy';

/** A note's copy for players: its Markdown and, by hash, the vault path of each image it names. */
export interface NoteCopy {
  readonly markdown: string;
  readonly images: Map<string, string>;
}

/** Copies the note at `path` (its `source`), resolving images through `images` and notes through `note`. */
export async function copyNote(source: string, path: string, images: QuestImages, note: CopyTargets['note']): Promise<NoteCopy> {
  const resolved = new Map<string, string>();
  const copy = await copyForPlayers(parseNote(source), {
    note,
    image: async (linkpath) => {
      const image = images.resolve(path, [{ target: linkpath, width: null, height: null }])[0];
      const ref = image === undefined ? null : await images.refOf(image.file);
      if (image !== undefined && ref !== null) resolved.set(ref.hash, image.file.path);
      return ref;
    },
  });
  const named = new Map<string, string>();
  for (const hash of copy.images.keys()) {
    const imagePath = resolved.get(hash);
    if (imagePath !== undefined) named.set(hash, imagePath);
  }
  return { markdown: copy.markdown, images: named };
}
