export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif';

/** Bytes `sniffImage` needs to tell the five types apart. */
export const SNIFF_BYTES = 12;

const startsWith = (head: Uint8Array, bytes: readonly number[], at = 0): boolean => head.length >= at + bytes.length && bytes.every((byte, i) => head[at + i] === byte);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** The image type the first bytes show (magic bytes only, never the name or a header), or null for anything else. */
export function sniffImage(head: Uint8Array): ImageMime | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(head, ascii('ftyp'), 4) && (startsWith(head, ascii('avif'), 8) || startsWith(head, ascii('avis'), 8))) return 'image/avif';
  return null;
}
