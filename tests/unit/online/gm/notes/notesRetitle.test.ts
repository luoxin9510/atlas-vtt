import { afterEach, describe, expect, it } from 'vitest';
import { retitled, type Entry } from '../../../../../src/app/online/gm/notes/sharedNotes.ts';
import { ANA, holdReads, shared, started, type Table } from './notesHarness.ts';
import { settled } from '../settled.ts';

const titles = (table: Table): string[] => table.list().map((note) => note.title);
const groups = (table: Table): Array<string | null> => table.list().map((note) => note.group ?? null);

describe('a renamed shared note', () => {
  let table: Table | undefined;
  afterEach(() => {
    table?.share.stop();
    table = undefined;
  });

  it('is listed under its new title at once, while its copy is still being read', async () => {
    table = await started({ 'Old.md': shared('Body.') });
    const id = table.list()[0]?.id ?? '';
    const before = table.list()[0]?.text;
    const hold = holdReads(table);
    await table.vault.move('Old.md', 'New.md');
    expect(hold.waiting).toBeGreaterThan(0);
    expect(titles(table)).toEqual(['New']);
    expect(table.lists(ANA).at(-1)?.notes.map((note) => note.title)).toEqual(['New']);
    await hold.release();
    expect(titles(table)).toEqual(['New']);
    expect(table.list()[0]?.id).toBe(id);
    expect(table.list()[0]?.text).toEqual(before);
    expect(await table.text(id)).toBe('Body.');
  });

  it('shows a group change at once', async () => {
    table = await started({ 'Keep.md': shared('Body.', 'atlas-share-group: Old group\n') });
    const hold = holdReads(table);
    table.vault.write('Keep.md', shared('Body.', 'atlas-share-group: New group\n'));
    expect(hold.waiting).toBeGreaterThan(0);
    expect(groups(table)).toEqual(['New group']);
    await hold.release();
    expect(groups(table)).toEqual(['New group']);
  });

  it('still withdraws and rebuilds a note that links to it', async () => {
    table = await started({ 'A.md': shared('See [[B|b]] here.'), 'B.md': shared('Plain B.') });
    const a = table.list().find((note) => note.title === 'A')?.id ?? '';
    const b = table.list().find((note) => note.title === 'B')?.id ?? '';
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
    await table.vault.move('B.md', 'Bee.md');
    table.vault.write('A.md', shared('See [[Bee|b]] here.'));
    await settled();
    expect(titles(table)).toEqual(['A', 'Bee']);
    expect(await table.text(a)).toBe(`See [b](atlas-note:${b}) here.`);
  });

  it('never publishes the new title once the note is no longer shared', async () => {
    table = await started({ 'Old.md': shared('Body.'), 'Other.md': shared('Other.') });
    const hold = holdReads(table);
    // The flag goes first, then the name changes: the new name was never a title of a shared note.
    table.vault.write('Old.md', 'Body.');
    await table.vault.move('Old.md', 'Secret Name.md');
    await hold.release();
    await settled();
    const everything = JSON.stringify(table.lists());
    expect(everything).not.toContain('Secret Name');
    expect(titles(table)).toEqual(['Other']);
  });

  it('sends nothing when a note whose flag was removed is renamed', async () => {
    table = await started({ 'Old.md': shared('Body.'), 'Other.md': shared('Other.') });
    table.vault.write('Old.md', 'Body.');
    await settled();
    expect(titles(table)).toEqual(['Other']);
    const hold = holdReads(table);
    table.sent.length = 0;
    await table.vault.move('Old.md', 'Hidden Plain.md');
    await hold.release();
    await settled();
    expect(JSON.stringify(table.sent)).not.toContain('Hidden Plain');
    expect(titles(table)).toEqual(['Other']);
  });
});

describe('retitled', () => {
  const entry = { id: 'note-1', title: 'Old', group: null } as unknown as Entry;

  it('gives the copy the title and group of its own note', () => {
    expect(retitled(entry, { id: 'note-1', title: 'New', group: 'Lore' })).toMatchObject({ id: 'note-1', title: 'New', group: 'Lore' });
  });

  it('takes nothing from another note\'s info, even when its title differs', () => {
    expect(retitled(entry, { id: 'note-2', title: 'New', group: 'Lore' })).toBeNull();
  });
});
