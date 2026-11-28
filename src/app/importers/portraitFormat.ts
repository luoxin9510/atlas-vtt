/**
 * The portrait formats Atlas keeps as they are (decision 26): PNG, JPG and WebP, told apart by
 * their magic numbers alone. Anything else, truncated bytes included, is `null`; unlike
 * `imageExtension`, which files an unknown image under WebP, nothing is guessed here.
 */

export type PortraitFormat = 'png' | 'jpg' | 'webp';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const startsWith = (data: Uint8Array, magic: readonly number[], offset = 0): boolean =>
  data.length >= offset + magic.length && magic.every((byte, at) => data[offset + at] === byte);

/** The format of the image `bytes` hold; null when it is not a PNG, JPG or WebP. */
export function portraitFormat(bytes: ArrayBuffer): PortraitFormat | null {
  const data = new Uint8Array(bytes);
  if (startsWith(data, PNG_MAGIC)) return 'png';
  if (startsWith(data, JPG_MAGIC)) return 'jpg';
  if (startsWith(data, RIFF) && startsWith(data, WEBP, 8)) return 'webp';
  return null;
}

/** The largest portrait Atlas keeps; a bigger file would stall the vault and every view that draws it. */
export const MAX_PORTRAIT_BYTES = 20 * 1024 * 1024;

/** Why a portrait is not kept (decision 26): a format Atlas does not keep, or a file over `MAX_PORTRAIT_BYTES`; null when it is kept. */
export function portraitProblem(bytes: ArrayBuffer): 'unsupported' | 'tooBig' | null {
  if (!portraitFormat(bytes)) return 'unsupported';
  return bytes.byteLength > MAX_PORTRAIT_BYTES ? 'tooBig' : null;
}
