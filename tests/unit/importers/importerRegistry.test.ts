import { describe, expect, it } from 'vitest';
import { importerById, importerFor, importerIds, registerImporter } from '../../../src/app/importers/importerRegistry';
import type { CharacterImporter } from '../../../src/app/importers/importerTypes';

let counter = 0;
/** An importer with ids unique to the test, so the shared registry never leaks between cases. */
function importer(extensions: string[], id = `reg-test:${++counter}`): CharacterImporter {
  return { id, label: id, extensions, parse: () => ({ name: id, templateId: 't', values: {} }) };
}

describe('importer registry', () => {
  it('finds an importer by id and lists its id until it is removed', () => {
    const one = importer(['aaa']);
    const remove = registerImporter(one);
    expect(importerById(one.id)).toBe(one);
    expect(importerIds()).toContain(one.id);
    remove();
    expect(importerById(one.id)).toBeUndefined();
    expect(importerIds()).not.toContain(one.id);
  });

  it('finds an importer by the extension of a file name, case-insensitively and without the dot', () => {
    const one = importer(['GCS', '.Foo']);
    const remove = registerImporter(one);
    expect(importerFor('Sir Robin.gcs')).toBe(one);
    expect(importerFor('Sir Robin.GCS')).toBe(one);
    expect(importerFor('dir.with.dots/robin.foo')).toBe(one);
    expect(importerFor('robin.txt')).toBeUndefined();
    expect(importerFor('gcs')).toBeUndefined();
    expect(importerFor('robin.')).toBeUndefined();
    remove();
    expect(importerFor('Sir Robin.gcs')).toBeUndefined();
  });

  it('lets the most recent registration of an extension win, and falls back when it is removed', () => {
    const first = importer(['bbb']);
    const second = importer(['bbb']);
    const removeFirst = registerImporter(first);
    const removeSecond = registerImporter(second);
    expect(importerFor('x.bbb')).toBe(second);
    removeSecond();
    expect(importerFor('x.bbb')).toBe(first);
    removeFirst();
    expect(importerFor('x.bbb')).toBeUndefined();
  });

  it('stacks registrations of one id: the last decides, and a removed one never returns', () => {
    const id = 'reg-test:stack';
    const older = importer(['ccc'], id);
    const newer = importer(['ccc'], id);
    const removeOlder = registerImporter(older);
    const removeNewer = registerImporter(newer);
    expect(importerById(id)).toBe(newer);
    removeOlder();
    expect(importerById(id)).toBe(newer);
    removeNewer();
    expect(importerById(id)).toBeUndefined();
    expect(importerFor('x.ccc')).toBeUndefined();
  });

  it('brings the older registration of an id back when the newer one is removed first', () => {
    const id = 'reg-test:order';
    const older = importer(['ddd'], id);
    const newer = importer(['eee'], id);
    const removeOlder = registerImporter(older);
    const removeNewer = registerImporter(newer);
    removeNewer();
    expect(importerById(id)).toBe(older);
    expect(importerFor('x.eee')).toBeUndefined();
    expect(importerFor('x.ddd')).toBe(older);
    removeOlder();
  });

  it('removes only once: a second call does nothing', () => {
    const one = importer(['fff']);
    const other = importer(['fff'], one.id);
    const remove = registerImporter(one);
    const removeOther = registerImporter(other);
    remove();
    remove();
    expect(importerById(one.id)).toBe(other);
    removeOther();
  });
});
