import { afterEach, describe, expect, it } from 'vitest';
import { chooseImportCollection } from '../../../src/app/importers/collectionChoice';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

afterEach(() => setLocale('en', TRANSLATIONS));

const collection = (id: string, name = ''): { id: string; name: string } => ({ id, name });

function run(collections: Array<{ id: string; name: string }>, preferred: string | null = null, picked: string | null = 'b'): { shown: Array<{ id: string; name: string }>[]; notices: string[]; chosen: Promise<string | null> } {
  const shown: Array<{ id: string; name: string }>[] = [];
  const notices: string[] = [];
  const chosen = chooseImportCollection({ collections, preferred, pick: (options) => { shown.push([...options]); return Promise.resolve(picked); }, notify: (message) => { notices.push(message); } });
  return { shown, notices, chosen };
}

describe('choosing the collection to import into', () => {
  it('says "Create a collection first" and chooses nothing when there are none', async () => {
    const { chosen, notices, shown } = run([]);
    expect(await chosen).toBeNull();
    expect(notices).toEqual(['Create a collection first.']);
    expect(shown).toEqual([]);
  });

  it('says it in Chinese too', async () => {
    setLocale('zh', TRANSLATIONS);
    const { chosen, notices } = run([]);
    await chosen;
    expect(notices).toEqual(['请先创建合集。']);
  });

  it('takes the only collection without asking', async () => {
    const { chosen, shown, notices } = run([collection('crew')]);
    expect(await chosen).toBe('crew');
    expect(shown).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('asks among several, the open map\'s collection first, naming each by its id when it has no name', async () => {
    const { chosen, shown } = run([collection('a', 'Alpha'), collection('b')], 'b');
    expect(await chosen).toBe('b');
    expect(shown).toEqual([[{ id: 'b', name: 'b' }, { id: 'a', name: 'Alpha' }]]);
  });

  it('is null when the person dismisses the picker', async () => {
    expect(await run([collection('a'), collection('b')], null, null).chosen).toBeNull();
  });
});
