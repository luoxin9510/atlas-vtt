import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetAnswers } from '../../../../../src/app/online/gm/assetAnswers.ts';
import { assetTag, sha256Hex } from '../../../../../src/app/online/gm/assetServe.ts';
import { notesTag } from '../../../../../src/app/online/gm/notes/notesTag.ts';
import { settled } from '../settled.ts';
import { ANA, gif, shared, started, type Table } from './notesHarness.ts';

/** A GIF 300 pixels wide: larger than the longest side the test asks for. */
const wide = (tail: string): string => `GIF89a,\u0001\u0001\u0000${tail}`;
const imageOf = (markdown: string): string => /atlas-asset:([0-9a-f]{64})/.exec(markdown)?.[1] ?? '';

describe('NotesShare routing and tags', () => {
  let table: Table | null = null;
  afterEach(() => {
    table?.share.stop();
    table = null;
  });

  it('tags the chunks of a scaled copy by the hash the player asked for', async () => {
    const scaled = new Uint8Array(40).map((_, index) => index);
    table = await started(
      { 'Keep.md': shared('![[art/map.gif]]'), 'art/map.gif': wide('one') },
      { scaleImage: () => Promise.resolve({ bytes: scaled, mime: 'image/webp', width: 100, height: 50 }) },
    );
    const image = imageOf(await table.text(table.list()[0]?.id ?? ''));
    const variant = await sha256Hex(scaled);
    table.sent.length = 0;
    table.share.receive(ANA, { t: 'asset-request', hash: image, maxSide: 256 });
    await vi.waitFor(() => expect(table?.sent.some((entry) => entry.body.t === 'asset-chunk')).toBe(true));
    const chunks = table.sent.filter((entry) => entry.body.t === 'asset-chunk');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((entry) => (entry.body as { hash: string }).hash === variant)).toBe(true);
    // Unsharing drops the original's tag, which is the tag the variant's chunks were queued under.
    expect(chunks.every((entry) => entry.tag === notesTag(image))).toBe(true);
  });

  it('answers a hash the notes held only through refuseGone, after the other shares', async () => {
    table = await started({ 'Keep.md': shared('![[art/map.gif]]'), 'art/map.gif': gif('one') });
    const image = imageOf(await table.text(table.list()[0]?.id ?? ''));
    table.vault.write('Keep.md', shared('No image now.'));
    await settled();
    table.sent.length = 0;
    const body = { t: 'asset-request', hash: image };
    expect(table.share.receive(ANA, body)).toBe(false);
    expect(table.sent).toEqual([]);
    expect(table.share.refuseGone(ANA, body)).toBe(true);
    expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: image }]);
    // A hash never held, a held one and another kind of message are none of its business.
    expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: 'f'.repeat(64) })).toBe(false);
    expect(table.share.refuseGone(ANA, { t: 'chat', text: 'hi' })).toBe(false);
    const held = table.list()[0]?.text.hash ?? '';
    expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: held })).toBe(false);
  });

  it('keeps one share\'s queued chunks when another share drops the same hash', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(300 * 1024));
    const hash = await sha256Hex(bytes);
    const sent: Array<{ tag: string | undefined }> = [];
    const ports = { send: (_body: unknown, _to: string, tag?: string): void => void sent.push({ tag }), now: () => 0, readImage: () => Promise.resolve(null) };
    const picture = { map: () => null, explored: () => undefined, artPath: () => undefined, text: (asked: string) => (asked === hash ? bytes : undefined) };
    new AssetAnswers(ports, picture, 'notes:').answer(ANA, { t: 'asset-request', hash });
    new AssetAnswers(ports, picture).answer('b'.repeat(20), { t: 'asset-request', hash });
    // The queue drops frames whose tag equals the one dropped: the scene share's frames stay.
    const kept = sent.filter((entry) => entry.tag !== notesTag(hash));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((entry) => entry.tag === assetTag(hash))).toBe(true);
    expect(sent.length).toBeGreaterThan(kept.length);
  });

  it('publishes the list after a stop and start while a read was under way', async () => {
    table = await started({ 'Keep.md': shared('The keep.') });
    const { vault } = table.vault.app;
    const read = vault.read.bind(vault);
    const held: Array<() => void> = [];
    vault.read = (file) => new Promise((resolve, reject) => void held.push(() => void read(file).then(resolve, reject)));
    table.share.stop();
    table.share.start();
    await settled();
    expect(held.length).toBeGreaterThan(0);
    table.share.stop();
    table.share.start();
    await settled();
    vault.read = read;
    table.sent.length = 0;
    // The newer read finishes first, the one of the epoch before last: only the newer epoch's count may decide.
    for (const release of held.splice(0).reverse()) {
      release();
      await settled();
    }
    expect(table.lists(ANA).at(-1)?.notes.map((note) => note.title)).toEqual(['Keep']);
  });
});
