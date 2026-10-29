import { assetTag } from '../assetServe.ts';

/** Starts the tag of every chunk the notes share queues, so dropping a note hash never drops another share's chunks of the same hash. */
export const NOTES_TAG_PREFIX = 'notes:';

/** The tag the notes share queues the chunks of `hash` under. */
export const notesTag = (hash: string): string => assetTag(hash, NOTES_TAG_PREFIX);
