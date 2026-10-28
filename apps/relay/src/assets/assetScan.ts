import { open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sniffImage, SNIFF_BYTES } from './sniff.ts';

const HASH_FILE = /^[0-9a-f]{64}$/;

/** What a former run left in one table's folder. `bytes` counts the complete images and the parts. */
export interface ScannedTable {
  readonly complete: Map<string, { size: number; mime: string }>;
  readonly parts: Map<string, Map<number, number>>;
  bytes: number;
}

/** Counts a table's folder; leftover temporary files and complete files that are no image are removed. */
export async function scanTable(folder: string): Promise<ScannedTable> {
  const found: ScannedTable = { complete: new Map(), parts: new Map(), bytes: 0 };
  for (const entry of await readdir(folder)) {
    if (entry.endsWith('.tmp')) await rm(join(folder, entry), { force: true });
    else if (HASH_FILE.test(entry)) await scanComplete(found, folder, entry);
  }
  const parts = join(folder, '.parts');
  for (const hash of await readdir(parts).catch(() => [])) {
    const held = new Map<number, number>();
    for (const name of await readdir(join(parts, hash))) {
      if (name.endsWith('.tmp')) await rm(join(parts, hash, name), { force: true });
      else if (/^[0-7]$/.test(name)) held.set(Number(name), (await stat(join(parts, hash, name))).size);
    }
    if (held.size > 0) found.parts.set(hash, held);
    for (const size of held.values()) found.bytes += size;
  }
  return found;
}

async function scanComplete(found: ScannedTable, folder: string, hash: string): Promise<void> {
  const file = await open(join(folder, hash), 'r');
  let mime: string | null;
  let size: number;
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await file.read(head, 0, SNIFF_BYTES, 0);
    mime = sniffImage(head.subarray(0, bytesRead));
    size = (await file.stat()).size;
  } finally {
    await file.close();
  }
  if (mime === null) {
    // Not an image (damaged or foreign): it is neither listed nor counted against the quota.
    await rm(join(folder, hash), { force: true });
    return;
  }
  found.complete.set(hash, { size, mime });
  found.bytes += size;
}
