import { afterEach, describe, expect, it } from 'vitest';
import { importerById, importerFor, importerIds } from '../../../src/app/importers/importerRegistry';
import type { CharacterImporter } from '../../../src/app/importers/importerTypes';
import { RulePacks } from '../../../src/app/rulePacks/rulePackApi';

const app = { workspace: { getLeavesOfType: () => [], trigger: (): void => undefined } } as never;
const created: RulePacks[] = [];
afterEach(() => { created.splice(0).forEach((api) => api.dispose()); });

function packs(): RulePacks {
  const api = new RulePacks(app);
  created.push(api);
  return api;
}

const importer = (over: Partial<CharacterImporter> = {}): CharacterImporter => ({
  id: 'pack:one', label: 'One', extensions: ['one'], parse: () => ({ name: 'N', templateId: 't', values: {} }), ...over,
});

describe('importers from a pack', () => {
  it('registers an importer, lists its id, and removes it again', () => {
    const api = packs();
    const one = importer();
    const remove = api.registerImporter(one);
    expect(api.importerIds()).toContain('pack:one');
    expect(importerFor('file.ONE')).toBe(one);
    remove();
    expect(api.importerIds()).not.toContain('pack:one');
    expect(importerById('pack:one')).toBeUndefined();
  });

  it('refuses empty and builtin: ids', () => {
    const api = packs();
    expect(() => api.registerImporter(importer({ id: '' }))).toThrow(/builtin:/);
    expect(() => api.registerImporter(importer({ id: 'builtin:mine' }))).toThrow(/builtin:/);
    expect(() => api.registerImporter(importer({ id: undefined as never }))).toThrow(/builtin:/);
    expect(api.importerIds()).not.toContain('builtin:mine');
  });

  it('refuses no extensions, a blank extension, a missing label or a missing parse', () => {
    const api = packs();
    expect(() => api.registerImporter(importer({ extensions: [] }))).toThrow(/extension/);
    expect(() => api.registerImporter(importer({ extensions: undefined as never }))).toThrow(/extension/);
    expect(() => api.registerImporter(importer({ extensions: ['ok', ' '] }))).toThrow(/extension/);
    expect(() => api.registerImporter(importer({ extensions: ['.'] }))).toThrow(/extension/);
    expect(() => api.registerImporter(importer({ label: '' }))).toThrow(/label/);
    expect(() => api.registerImporter(importer({ label: undefined as never }))).toThrow(/label/);
    expect(() => api.registerImporter(importer({ parse: undefined as never }))).toThrow(/parse/);
    expect(importerById('pack:one')).toBeUndefined();
  });

  it('removes what is left when Atlas unloads, and takes no more afterwards', () => {
    const api = packs();
    api.registerImporter(importer({ id: 'pack:a', extensions: ['aa1'] }));
    api.registerImporter(importer({ id: 'pack:b', extensions: ['bb1'] }));
    api.dispose();
    expect(importerIds()).not.toContain('pack:a');
    expect(importerIds()).not.toContain('pack:b');
    const late = api.registerImporter(importer({ id: 'pack:c', extensions: ['cc1'] }));
    expect(importerById('pack:c')).toBeUndefined();
    expect(() => late()).not.toThrow();
  });

  it('brings back the importer a replaced one shadowed only while it is registered, and never a removed one', () => {
    const api = packs();
    const older = importer({ extensions: ['dd1'] });
    const newer = importer({ extensions: ['dd1'] });
    const removeOlder = api.registerImporter(older);
    const removeNewer = api.registerImporter(newer);
    expect(importerById('pack:one')).toBe(newer);
    removeOlder();
    removeNewer();
    expect(importerById('pack:one')).toBeUndefined();
  });

  it('keeps apiVersion 1', () => {
    expect(packs().apiVersion).toBe(1);
  });
});
