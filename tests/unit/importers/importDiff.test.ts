import { describe, expect, it } from 'vitest';
import { diffImport } from '../../../src/app/importers/importDiff';

describe('import diff', () => {
  it('lists a changed scalar with its old and new value', () => {
    const changes = diffImport({ hp: 10, name: 'Robin' }, { hp: 12, name: 'Robin' }, ['hp', 'name']);
    expect(changes).toEqual([{ key: 'hp', kind: 'changed', detail: { type: 'scalar', from: '10', to: '12' } }]);
  });

  it('lists a key the note lacked as added', () => {
    expect(diffImport({}, { hp: 12 }, [])).toEqual([{ key: 'hp', kind: 'added', detail: { type: 'scalar', to: '12' } }]);
  });

  it('lists a key of the record the file no longer gives as removed, and only when the note holds it', () => {
    expect(diffImport({ luck: 3, hp: 10 }, { hp: 10 }, ['hp', 'luck'])).toEqual([{ key: 'luck', kind: 'removed', detail: { type: 'scalar', from: '3' } }]);
    expect(diffImport({ hp: 10 }, { hp: 10 }, ['hp', 'luck'])).toEqual([]);
  });

  it('never looks at keys that were not imported', () => {
    expect(diffImport({ hp: 10, notes: 'mine', template: 'x' }, { hp: 10 }, ['hp'])).toEqual([]);
  });

  it('cuts long text', () => {
    const [change] = diffImport({ bio: 'a' }, { bio: 'b'.repeat(100) }, ['bio']);
    expect(change?.detail).toMatchObject({ type: 'scalar', from: 'a' });
    expect(change?.detail.type === 'scalar' && change.detail.to?.length).toBe(40);
  });

  it('names list items that were added and removed', () => {
    const [change] = diffImport({ skills: ['Axe', 'Bow'] }, { skills: ['Bow', 'Shield'] }, ['skills']);
    expect(change).toEqual({ key: 'skills', kind: 'changed', detail: { type: 'list', added: ['Shield'], removed: ['Axe'], changed: [] } });
  });

  it('names entries by their name and shows the one value that changed', () => {
    const before = [{ name: 'Broadsword', level: 15 }, { name: 'Axe', level: 10 }];
    const after = [{ name: 'Broadsword', level: 16 }, { name: 'Shield', level: 11 }];
    const [change] = diffImport({ skills: before }, { skills: after }, ['skills']);
    expect(change?.detail).toEqual({ type: 'list', added: ['Shield'], removed: ['Axe'], changed: ['Broadsword 15 → 16'] });
  });

  it('says only "changed" for a nested object and ignores the order of its keys', () => {
    expect(diffImport({ stats: { a: 1, b: 2 } }, { stats: { b: 2, a: 1 } }, ['stats'])).toEqual([]);
    expect(diffImport({ stats: { a: 1 } }, { stats: { a: 2 } }, ['stats'])).toEqual([{ key: 'stats', kind: 'changed', detail: { type: 'object' } }]);
  });

  it('says a same-named entry changed when more than one value differs', () => {
    const [change] = diffImport({ skills: [{ name: 'Axe', level: 1, note: 'a' }] }, { skills: [{ name: 'Axe', level: 2, note: 'b' }] }, ['skills']);
    expect(change?.detail).toMatchObject({ type: 'list', changed: ['Axe changed'] });
  });

  it('tells the n-th of equal names apart', () => {
    const [change] = diffImport({ attacks: [{ name: 'Bite', d: 1 }, { name: 'Bite', d: 2 }] }, { attacks: [{ name: 'Bite', d: 1 }, { name: 'Bite', d: 3 }] }, ['attacks']);
    expect(change?.detail).toMatchObject({ type: 'list', changed: ['Bite 2 → 3'] });
  });

  it('lists a removed list with all its items as removed', () => {
    const [change] = diffImport({ skills: ['Axe'] }, {}, ['skills']);
    expect(change).toEqual({ key: 'skills', kind: 'removed', detail: { type: 'list', added: [], removed: ['Axe'], changed: [] } });
  });
});
