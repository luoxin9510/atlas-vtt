import { isHash, isRecord, PART_BYTES } from '../../protocol/index.ts';
import type { BinaryHttp } from './binaryHttp.ts';

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

/** How an upload ended: `busy` when the relay said 429 (try again soon), `failed` for anything else. */
export type UploadOutcome = 'ok' | 'busy' | 'failed';

/** A part is tried again after a network error or a 5xx other than 507; 429, 507 and the other 4xx end it at once. */
async function putPart(http: BinaryHttp, table: TableAccess, hash: string, index: number, bytes: Uint8Array): Promise<UploadOutcome> {
  const slice = bytes.slice(index * PART_BYTES, (index + 1) * PART_BYTES);
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const answer = await http({ url: assetUrl(table, hash, `/parts/${index}`), method: 'PUT', secret: table.secret, body: slice.buffer }).catch(() => null);
    if (answer?.status === 200) return 'ok';
    if (answer !== null && (answer.status === 429 || (answer.status >= 400 && answer.status < 500) || answer.status === 507)) return answer.status === 429 ? 'busy' : 'failed';
  }
  return 'failed';
}

const outcomeOf = (status: number | undefined): UploadOutcome => (status === 429 ? 'busy' : 'failed');

/**
 * Puts the image `hash` (`bytes`) into the table's server cache: asks which parts the relay holds,
 * sends the missing ones and completes. `ok` only when the relay holds the image under `hash`.
 */
export async function tryUpload(http: BinaryHttp, table: TableAccess, hash: string, bytes: Uint8Array): Promise<UploadOutcome> {
  if (!isHash(hash)) return 'failed';
  const status = await http({ url: assetUrl(table, hash), method: 'GET', secret: table.secret }).catch(() => null);
  if (status?.status !== 200) return outcomeOf(status?.status);
  const held = heldParts(status.json);
  if (held === undefined) return 'failed';
  if (held === null) return 'ok';
  const count = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
  for (let index = 0; index < count; index += 1) {
    if (held.has(index)) continue;
    const part = await putPart(http, table, hash, index, bytes);
    if (part !== 'ok') return part;
  }
  const done = await http({ url: assetUrl(table, hash, '/complete'), method: 'POST', secret: table.secret }).catch(() => null);
  if (done?.status !== 200) return outcomeOf(done?.status);
  return isRecord(done.json) && done.json.hash === hash ? 'ok' : 'failed';
}

/** `tryUpload` as a yes or no: true only when the relay holds the image under `hash`. */
export async function uploadAsset(http: BinaryHttp, table: TableAccess, hash: string, bytes: Uint8Array): Promise<boolean> {
  return (await tryUpload(http, table, hash, bytes)) === 'ok';
}
