import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGmMessage, type AssetRef, type GmMessage } from '../../../../../src/app/online/protocol/index.ts';
import { notesTag } from '../../../../../src/app/online/gm/notes/notesTag.ts';
import { settled } from '../settled.ts';
import { ANA, BEN, clock, gif, holdReads, makeTable, OLD, shared, started, type Table } from './notesHarness.ts';

const titles = (table: Table): string[] => table.list().map((note) => note.title);
const idOf = (table: Table, title: string): string => table.list().find((note) => note.title === title)?.id ?? '';

describe('NotesShare', () => {
  let table: Table | null = null;
  afterEach(() => {
    table?.share.stop();
    table = null;
  });

  it('lists only notes with atlas-share true', async () => {
    table = await started({
      'Keep.md': shared('The keep.'),
      'Boolean.md': '---\natlas-share: "true"\n---\nno',
      'Yes.md': '---\natlas-share: yes\n---\nno',
      'One.md': '---\natlas-share: 1\n---\nno',
      'Plain.md': 'no',
      'Cave.md': shared('A cave.', 'atlas-share-group: Places\n'),
    });
    expect(table.list().map((note) => [note.title, note.group])).toEqual([['Cave', 'Places'], ['Keep', undefined]]);
    expect(table.list().every((note) => /^[0-9a-f]{24}$/.test(note.id))).toBe(true);
    expect(table.share.count).toBe(2);
  });

  it('sends notes to level-3 players only', async () => {
    table = await started({ 'Keep.md': shared('The keep.') });
    expect(table.lists(ANA).length).toBeGreaterThan(0);
    expect(table.lists(BEN)).toEqual([]);
    expect(table.lists(OLD)).toEqual([]);
  });

  it('sends the list after a client message', async () => {
    table = await started({ 'Keep.md': shared('The keep.') });
    table.sent.length = 0;
    table.share.client(BEN);
    expect(table.sent).toEqual([]);
    table.levels.set(BEN, 3);
    table.share.client(BEN);
    expect(parseGmMessage(table.sent[0]?.body)).toMatchObject({ t: 'notes' });
    expect(table.sent[0]?.to).toBe(BEN);
  });

  it('serves a shared note\'s text and its images', async () => {
    table = await started({ 'Keep.md': shared('Look: ![[art/map.gif]]'), 'art/map.gif': gif('one') });
    const [note] = table.list();
    const markdown = await table.text(note?.id ?? '');
    expect(markdown).toMatch(/^Look: !\[]\(atlas-asset:[0-9a-f]{64}\?size=\d+\\?&mime=image\/gif\)$/);
    const image = /atlas-asset:([0-9a-f]{64})/.exec(markdown)?.[1] ?? '';
    table.sent.length = 0;
    table.request(ANA, image);
    await settled();
    const chunks = table.sent.filter((entry) => entry.body.t === 'asset-chunk');
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.tag).toBe(notesTag(image));
    expect(Buffer.from((chunks[0]?.body as { data: string }).data, 'base64').toString('utf8')).toBe(gif('one'));
  });

  it('refuses hashes it does not hold', async () => {
    table = await started({ 'Keep.md': shared('The keep.') });
    expect(table.share.receive(ANA, { t: 'asset-request', hash: 'f'.repeat(64) })).toBe(false);
    expect(table.share.receive(ANA, { t: 'chat', text: 'hi' })).toBe(false);
    // Players below level 3 are not served, whatever the hash.
    const hash = table.list()[0]?.text.hash ?? '';
    expect(table.share.receive(BEN, { t: 'asset-request', hash })).toBe(false);
    table.vault.write('Keep.md', '---\natlas-share: false\n---\nThe keep.');
    await settled();
    table.sent.length = 0;
    expect(table.share.refuseGone(ANA, { t: 'asset-request', hash })).toBe(true);
    expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash }]);
    expect(table.share.receive(ANA, { t: 'asset-request', hash: 'f'.repeat(64) })).toBe(false);
  });

  it('drops queued chunks when a note is edited to hide a passage', async () => {
    table = await started({ 'Keep.md': shared('Open words.\n\nSecret passage.') });
    const before = table.list()[0] as { id: string; text: AssetRef };
    expect(await table.text(before.id)).toContain('Secret passage.');
    table.dropped.length = 0;
    table.vault.write('Keep.md', shared('Open words.\n\n> [!gm]\n> Secret passage.'));
    await settled();
    expect(table.dropped).toContain(notesTag(before.text.hash));
    const after = table.list()[0] as { id: string; text: AssetRef };
    expect(after.id).toBe(before.id);
    expect(after.text.hash).not.toBe(before.text.hash);
    expect(await table.text(after.id)).not.toContain('Secret');
  });

  it('refuses the old hash after unsharing', async () => {
    table = await started({ 'Keep.md': shared('The keep.'), 'Cave.md': shared('A cave.') });
    const keep = table.list().find((note) => note.title === 'Keep') as { id: string; text: AssetRef };
    const cave = table.list().find((note) => note.title === 'Cave') as { text: AssetRef };
    table.vault.write('Keep.md', 'The keep.');
    await settled();
    expect(titles(table)).toEqual(['Cave']);
    expect(table.dropped).toContain(notesTag(keep.text.hash));
    table.sent.length = 0;
    expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: keep.text.hash })).toBe(true);
    expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: keep.text.hash }]);
    // Deleting a note does the same.
    table.vault.remove('Cave.md');
    await settled();
    expect(table.list()).toEqual([]);
    expect(table.dropped).toContain(notesTag(cave.text.hash));
  });

  it('withdraws a title the copy carries even when the link index does not list the link', async () => {
    // A markdown link is resolved by the copy but not by the mock's wikilink index, as with a form Obsidian does not index.
    table = await started({ 'A.md': shared('See [b](B.md) here.'), 'B.md': shared('Plain B.') });
    const a = idOf(table, 'A');
    const b = idOf(table, 'B');
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
    table.vault.write('B.md', 'Plain B.');
    await settled();
    expect(titles(table)).toEqual(['A']);
    expect(await table.text(a)).toBe('See b here.');
  });

  it('drops an image that is no longer named', async () => {
    table = await started({ 'Keep.md': shared('![[art/map.gif]]'), 'art/map.gif': gif('one') });
    const markdown = await table.text(table.list()[0]?.id ?? '');
    const image = /atlas-asset:([0-9a-f]{64})/.exec(markdown)?.[1] ?? '';
    table.vault.write('art/map.gif', gif('two'));
    await settled();
    expect(table.dropped).toContain(notesTag(image));
    table.sent.length = 0;
    table.request(ANA, image);
    expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: image }]);
  });

  it('follows renames and flag changes', async () => {
    table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': 'Plain B.' });
    const a = idOf(table, 'A');
    expect(await table.text(a)).toBe('See b here.');
    table.vault.write('B.md', shared('Plain B.'));
    await settled();
    const b = idOf(table, 'B');
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
    await table.vault.move('B.md', 'Folder/B.md');
    await settled();
    expect(idOf(table, 'B')).toBe(b);
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
    // A new name is a new title; Obsidian rewrites the links to it.
    await table.vault.move('Folder/B.md', 'Folder/Bee.md');
    table.vault.write('A.md', shared('See [[Bee|b]] here.'));
    await settled();
    expect(idOf(table, 'Bee')).toBe(b);
    expect(titles(table)).toEqual(['A', 'Bee']);
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
    table.vault.write('Folder/Bee.md', 'Plain B.');
    await settled();
    expect(titles(table)).toEqual(['A']);
    expect(await table.text(a)).toBe('See b here.');
  });

  it('caps the list at 500 notes by title and says so', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 502; index++) files[`N${String(index).padStart(3, '0')}.md`] = shared('x');
    table = await started(files);
    expect(table.list().length).toBe(500);
    expect(table.share.capped).toBe(true);
    expect(titles(table)[499]).toBe('N499');
  });

  it('tells the table when the shared set changes, so the dock can show the count', async () => {
    let changes = 0;
    table = await started({ 'A.md': shared('a'), 'B.md': 'b' }, { changed: () => void (changes += 1) });
    expect(changes).toBeGreaterThan(0);
    const before = changes;
    table.vault.write('B.md', shared('b'));
    await settled();
    expect(changes).toBeGreaterThan(before);
    expect(table.share.count).toBe(2);
  });

  it('never logs titles', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    try {
      table = await started({ 'Zorblax Secret.md': shared('See [[Quux Hidden]].', 'atlas-share-group: Gruppe Geheim\n'), 'Quux Hidden.md': 'hidden', 'art/Pic Name.gif': gif('x') });
      table.vault.write('Zorblax Secret.md', shared('![[Pic Name.gif]] [[Quux Hidden]]', 'atlas-share-group: Gruppe Geheim\n'));
      await settled();
      await table.vault.move('Zorblax Secret.md', 'Zorblax Renamed.md');
      await settled();
      table.vault.remove('Zorblax Renamed.md');
      await settled();
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      for (const word of ['Zorblax', 'Quux', 'Gruppe', 'Pic Name']) expect(logged).not.toContain(word);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  describe('fails closed', () => {
    it('withdraws a note whose rebuild throws, and does not read it again for the same source', async () => {
      table = await started({ 'Keep.md': shared('Open.\n\nSecret passage.') });
      const old = table.list()[0] as { text: AssetRef };
      const reads = vi.spyOn(table.vault.app.vault, 'read').mockRejectedValue(new Error('disk'));
      table.vault.write('Keep.md', shared('Open.\n\n> [!gm]\n> Secret passage.'));
      await settled();
      expect(table.list()).toEqual([]);
      expect(table.dropped).toContain(notesTag(old.text.hash));
      table.sent.length = 0;
      expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: old.text.hash })).toBe(true);
      expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: old.text.hash }]);
      const attempts = reads.mock.calls.length;
      table.vault.resolve();
      table.vault.write('Other.md', 'x');
      await settled();
      expect(reads.mock.calls.length).toBe(attempts);
      // A later change of the note reads it again.
      reads.mockRestore();
      table.vault.write('Keep.md', shared('Open again.'));
      await settled();
      expect(titles(table)).toEqual(['Keep']);
    });

    it('withdraws a note whose copy outgrows what an asset holds', async () => {
      table = await started({ 'Keep.md': shared('Short.') }, { maxBytes: 64 });
      const old = table.list()[0] as { text: AssetRef };
      table.vault.write('Keep.md', shared('Long. '.repeat(40)));
      await settled();
      expect(table.list()).toEqual([]);
      expect(table.dropped).toContain(notesTag(old.text.hash));
      const reads = vi.spyOn(table.vault.app.vault, 'read');
      reads.mockClear();
      table.vault.resolve();
      await settled();
      expect(reads).not.toHaveBeenCalled();
      table.sent.length = 0;
      expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: old.text.hash })).toBe(true);
      expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: old.text.hash }]);
    });

    it('keeps the newer copy when an older read finishes last', async () => {
      table = await started({ 'Keep.md': shared('First.') });
      const reads = holdReads(table);
      table.vault.write('Keep.md', shared('Second.'));
      table.vault.write('Keep.md', shared('Third.'));
      expect(reads.waiting).toBe(2);
      await reads.release(1);
      await reads.release(0);
      expect(table.list().length).toBe(1);
      expect(await table.text(table.list()[0]?.id ?? '')).toBe('Third.');
    });

    it('discards a read that finishes after its note was unshared', async () => {
      table = await started({ 'Keep.md': shared('First.') });
      const reads = holdReads(table);
      table.vault.write('Keep.md', shared('Second.'));
      table.vault.write('Keep.md', 'No longer shared.');
      expect(table.list().length).toBe(0);
      await reads.release();
      await reads.release();
      expect(table.list()).toEqual([]);
      expect(table.share.count).toBe(0);
      // Nothing is kept for it either, or sharing it again without a change would bring the stale copy back.
      expect((table.share as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0);
    });

    it('serves an image shared by two notes until both stop naming it', async () => {
      table = await started({ 'A.md': shared('![[art/map.gif]]'), 'B.md': shared('![[art/map.gif]] again'), 'art/map.gif': gif('one') });
      const markdown = await table.text(idOf(table, 'A'));
      const image = /atlas-asset:([0-9a-f]{64})/.exec(markdown)?.[1] ?? '';
      const fetched = async (): Promise<GmMessage[]> => {
        table?.sent.splice(0);
        table?.share.playerLeft(ANA);
        table?.request(ANA, image);
        await settled();
        return table?.sent.map((entry) => entry.body) ?? [];
      };
      table.vault.write('A.md', 'unshared');
      await settled();
      expect((await fetched()).map((body) => body.t)).toEqual(['asset-chunk']);
      table.vault.write('B.md', 'unshared');
      await settled();
      expect(await fetched()).toEqual([{ t: 'asset-refused', hash: image }]);
    });

    it('withdraws the notes that link to a note at once when it is unshared, and lists them again once read', async () => {
      table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': shared('B.'), 'C.md': shared('Alone.') });
      const a = table.list().find((note) => note.title === 'A') as { text: AssetRef };
      const reads = holdReads(table);
      table.dropped.length = 0;
      table.vault.write('B.md', 'B.');
      expect(titles(table)).toEqual(['C']);
      expect(table.dropped).toContain(notesTag(a.text.hash));
      table.sent.length = 0;
      expect(table.share.refuseGone(ANA, { t: 'asset-request', hash: a.text.hash })).toBe(true);
      expect(table.sent.map((entry) => entry.body)).toEqual([{ t: 'asset-refused', hash: a.text.hash }]);
      await reads.release();
      expect(titles(table)).toEqual(['A', 'C']);
      expect(await table.text(idOf(table, 'A'))).toBe('See b here.');
    });

    it('keeps a note listed when a note it links to that is not shared is renamed or moved', async () => {
      table = await started({ 'A.md': shared('See [[C]] here.'), 'C.md': 'Not shared.' });
      const reads = holdReads(table);
      table.dropped.length = 0;
      await table.vault.move('C.md', 'Z/C.md');
      table.vault.resolve();
      expect(titles(table)).toEqual(['A']);
      expect(table.dropped).toEqual([]);
      expect(reads.waiting).toBe(0);
    });

    it('keeps a note listed, unchanged, when a shared note it links to moves to another folder', async () => {
      table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': shared('B.') });
      const before = table.list().find((note) => note.title === 'A') as { text: AssetRef };
      holdReads(table);
      table.dropped.length = 0;
      await table.vault.move('B.md', 'Z/B.md');
      table.vault.resolve();
      expect(titles(table)).toEqual(['A', 'B']);
      expect(table.dropped).toEqual([]);
      expect(table.list().find((note) => note.title === 'A')?.text).toEqual(before.text);
    });

    it('keeps a note listed while it is read again because a note it linked to is now shared', async () => {
      table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': 'Not yet.' });
      expect(await table.text(idOf(table, 'A'))).toBe('See b here.');
      const reads = holdReads(table);
      table.vault.write('B.md', shared('B.'));
      expect(titles(table)).toEqual(['A']);
      while (reads.waiting > 0) await reads.release();
      expect(titles(table)).toEqual(['A', 'B']);
      expect(await table.text(idOf(table, 'A'))).toBe(`See [b](atlas-note:${idOf(table, 'B')}) here.`);
    });

    it('withdraws a note at once when a shared note it links to is retitled, and lists it again once read', async () => {
      table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': shared('B.'), 'C.md': shared('Alone.') });
      const a = table.list().find((note) => note.title === 'A') as { text: AssetRef };
      const reads = holdReads(table);
      table.dropped.length = 0;
      await table.vault.move('B.md', 'Beta.md');
      expect(titles(table)).not.toContain('A');
      expect(table.dropped).toContain(notesTag(a.text.hash));
      while (reads.waiting > 0) await reads.release();
      expect(titles(table)).toEqual(['A', 'Beta', 'C']);
    });

    describe('after a read that failed', () => {
      it('lists the note again when a later read works', async () => {
        const time = clock();
        table = await started({ 'Keep.md': shared('Open.') }, { timers: time });
        const reads = vi.spyOn(table.vault.app.vault, 'read').mockRejectedValueOnce(new Error('busy'));
        reads.mockClear();
        table.vault.write('Keep.md', shared('Changed.'));
        await settled();
        expect(table.list()).toEqual([]);
        time.advance(1_999);
        await settled();
        expect(table.list()).toEqual([]);
        time.advance(1);
        await settled();
        expect(titles(table)).toEqual(['Keep']);
        expect(reads).toHaveBeenCalledTimes(2);
      });

      it('reads a note that always fails four times, and not after stop', async () => {
        const time = clock();
        table = await started({ 'Keep.md': shared('Open.') }, { timers: time });
        const reads = vi.spyOn(table.vault.app.vault, 'read').mockRejectedValue(new Error('busy'));
        reads.mockClear();
        table.vault.write('Keep.md', shared('Changed.'));
        await settled();
        for (const ms of [2_000, 10_000, 60_000, 600_000]) {
          time.advance(ms);
          await settled();
        }
        expect(reads).toHaveBeenCalledTimes(4);
        expect(time.pending).toBe(0);
        table.vault.write('Keep.md', shared('Again.'));
        await settled();
        expect(reads).toHaveBeenCalledTimes(5);
        expect(time.pending).toBe(1);
        table.share.stop();
        expect(time.pending).toBe(0);
        time.advance(600_000);
        await settled();
        expect(reads).toHaveBeenCalledTimes(5);
      });

      it('withdraws a note at once when a title its copy names is gone, whatever an old failure left behind', async () => {
        table = await started({ 'A.md': shared('See [[B|b]] and [[C|c]].'), 'B.md': shared('B.'), 'C.md': 'Not shared.' });
        const reads = vi.spyOn(table.vault.app.vault, 'read').mockRejectedValueOnce(new Error('busy'));
        reads.mockClear();
        table.vault.write('A.md', shared('See [[B|b]] and [[C|c]]!'));
        await settled();
        expect(titles(table)).toEqual(['B']);
        table.vault.write('C.md', shared('C.'));
        await settled();
        expect(titles(table)).toEqual(['A', 'B', 'C']);
        table.dropped.length = 0;
        table.vault.write('C.md', 'Not shared.');
        expect(titles(table)).toEqual(['B']);
        await settled();
        expect(titles(table)).toEqual(['A', 'B']);
        expect(await table.text(idOf(table, 'A'))).toBe(`See [b](atlas-note:${idOf(table, 'B')}) and c!`);
      });

      it('does not retry a copy that is too large', async () => {
        const time = clock();
        table = await started({ 'Keep.md': shared('Short.') }, { maxBytes: 64, timers: time });
        table.vault.write('Keep.md', shared('Long. '.repeat(40)));
        await settled();
        const reads = vi.spyOn(table.vault.app.vault, 'read');
        reads.mockClear();
        expect(time.pending).toBe(0);
        time.advance(600_000);
        await settled();
        expect(reads).not.toHaveBeenCalled();
        expect(table.list()).toEqual([]);
      });
    });

    it('removes every listener when it stops, and answers nothing afterwards', async () => {
      table = makeTable({ 'Keep.md': shared('Words.') });
      const live = new Set<unknown>();
      let registered = 0;
      for (const target of [table.vault.app.vault, table.vault.app.metadataCache] as const) {
        const on = target.on.bind(target) as (...args: unknown[]) => unknown;
        const offref = target.offref.bind(target) as (ref: unknown) => void;
        (target as { on: unknown }).on = (...args: unknown[]): unknown => {
          const ref = on(...args);
          live.add(ref);
          registered++;
          return ref;
        };
        (target as { offref: unknown }).offref = (ref: unknown): void => {
          live.delete(ref);
          offref(ref);
        };
      }
      table.share.start();
      await settled();
      expect(registered).toBeGreaterThan(0);
      table.share.resend();
      const held = table.list()[0] as { text: AssetRef };
      table.share.stop();
      expect(live.size).toBe(0);
      expect(table.share.receive(ANA, { t: 'asset-request', hash: held.text.hash })).toBe(false);
    });
  });
});
