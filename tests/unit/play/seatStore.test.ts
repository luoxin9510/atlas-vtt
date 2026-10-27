import { describe, expect, it } from 'vitest';
import { seatStore } from '../../../apps/play/src/net/seatStore.ts';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('seatStore', () => {
  it('round trips a seat under atlas-play:seat:<code>', () => {
    const storage = memory();
    const store = seatStore(storage);
    store.write('abc', { id: 'p1', key: 'k'.repeat(20), name: 'Ann' });
    expect(storage.data.has('atlas-play:seat:abc')).toBe(true);
    expect(store.read('abc')).toEqual({ id: 'p1', key: 'k'.repeat(20), name: 'Ann' });
    expect(store.read('other')).toBeNull();
  });

  it('reads unreadable JSON or a wrong shape as null', () => {
    const storage = memory();
    const store = seatStore(storage);
    storage.data.set('atlas-play:seat:abc', '{nope');
    expect(store.read('abc')).toBeNull();
    storage.data.set('atlas-play:seat:abc', JSON.stringify({ id: 1 }));
    expect(store.read('abc')).toBeNull();
  });

  it('forgets a seat', () => {
    const store = seatStore(memory());
    store.write('abc', { id: 'p1', key: 'k', name: 'Ann' });
    store.forget('abc');
    expect(store.read('abc')).toBeNull();
  });

  it('keeps the own join code apart', () => {
    const storage = memory();
    const store = seatStore(storage);
    expect(store.ownCode('abc')).toBeNull();
    store.writeOwnCode('abc', 'JOIN1');
    expect(storage.data.get('atlas-play:own-code:abc')).toBe('JOIN1');
    expect(store.ownCode('abc')).toBe('JOIN1');
  });

  it('works without storage and when storage throws', () => {
    const none = seatStore(null);
    none.write('a', { id: 'x', key: 'y', name: 'z' });
    expect(none.read('a')).toBeNull();
    const broken = seatStore({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } });
    broken.write('a', { id: 'x', key: 'y', name: 'z' });
    expect(broken.read('a')).toBeNull();
    expect(broken.ownCode('a')).toBeNull();
  });
});
