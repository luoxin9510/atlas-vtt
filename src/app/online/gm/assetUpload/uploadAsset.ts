import { isHash, isRecord } from '../../protocol/index.ts';
import type { BinaryHttp } from './binaryHttp.ts';

/** The relay's part size: an image goes up in slices of at most this many bytes. */
export const PART_BYTES = 8 * 1024 * 1024;
const TRIES = 3;

/** Where a table's images go and the secret that lets the GM put them there. */
export interface TableAccess {
  readonly origin: string;
  readonly code: string;
  readonly secret: string;
}

/** The URL of a table's image route (`suffix` starts with a slash, or is empty). */
export function assetUrl(table: TableAccess, hash: string, suffix = ''): string {
  return `${table.origin}/api/tables/${table.code}/assets/${hash}${suffix}`;
}

/** The part indices the relay holds, null when it says the image is complete, undefined when it said nothing usable. */
function heldParts(json: unknown): ReadonlySet<number> | null | undefined {
  if (!isRecord(json)) return undefined;
  if (json.complete === true) return null;
  const parts = json.parts;
  return Array.isArray(parts) && parts.every((part) => typeof part === 'number') ? new Set<number>(parts) : undefined;
}

async function putPart(http: BinaryHttp, table: TableAccess, hash: string, index: number, bytes: Uint8Array): Promise<boolean> {
  const slice = bytes.slice(index * PART_BYTES, (index + 1) * PART_BYTES);
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const answer = await http({ url: assetUrl(table, hash, `/parts/${index}`), method: 'PUT', secret: table.secret, body: slice.buffer }).catch(() => null);
    if (answer?.status === 200) return true;
  }
  return false;
}

/**
 * Puts the image `hash` (`bytes`) into the table's server cache: asks which parts the relay holds,
 * sends the missing ones (each tried up to three times) and completes. True only when the relay
 * holds the image under `hash`.
 */
export async function uploadAsset(http: BinaryHttp, table: TableAccess, hash: string, bytes: Uint8Array): Promise<boolean> {
  if (!isHash(hash)) return false;
  const status = await http({ url: assetUrl(table, hash), method: 'GET', secret: table.secret }).catch(() => null);
  if (status?.status !== 200) return false;
  const held = heldParts(status.json);
  if (held === undefined) return false;
  if (held === null) return true;
  const count = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
  for (let index = 0; index < count; index += 1) {
    if (!held.has(index) && !(await putPart(http, table, hash, index, bytes))) return false;
  }
  const done = await http({ url: assetUrl(table, hash, '/complete'), method: 'POST', secret: table.secret }).catch(() => null);
  return done?.status === 200 && isRecord(done.json) && done.json.hash === hash;
}
