import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PORTRAIT_BYTES, validatedCharacter } from '../../../src/app/importers/validateImported';
import { portraitProblem } from '../../../src/app/importers/portraitFormat';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).buffer;
const good = (extra: Record<string, unknown> = {}): unknown => ({ name: 'Robin', templateId: 'tpl', values: { hp: 10, skills: ['Axe'] }, ...extra });

afterEach(() => setLocale('en', TRANSLATIONS));

describe('what an importer may hand over', () => {
  it('passes a good character through, the name trimmed', () => {
    expect(validatedCharacter(good({ name: '  Robin  ' }))).toEqual({ name: 'Robin', templateId: 'tpl', values: { hp: 10, skills: ['Axe'] } });
  });

  it('keeps the portrait bytes', () => {
    expect(validatedCharacter(good({ portrait: { bytes: PNG } })).portrait?.bytes).toBe(PNG);
  });

  it.each([
    ['nothing', undefined],
    ['a text', 'Robin'],
    ['a name that is no text', { name: 5, templateId: 'tpl', values: {} }],
    ['an empty name', { name: '   ', templateId: 'tpl', values: {} }],
    ['a name too long for a note', { name: 'x'.repeat(201), templateId: 'tpl', values: {} }],
    ['a template id that is no text', { name: 'a', templateId: 3, values: {} }],
    ['an empty template id', { name: 'a', templateId: '', values: {} }],
    ['values that are no object', { name: 'a', templateId: 'tpl', values: [1] }],
    ['values that are missing', { name: 'a', templateId: 'tpl' }],
  ])('refuses %s', (_label, raw) => {
    expect(() => validatedCharacter(raw)).toThrow();
  });

  it('refuses values that JSON cannot hold: functions, class instances, NaN, Infinity, cycles', () => {
    class Thing { x = 1; }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const values of [{ a: () => 1 }, { a: new Thing() }, { a: Number.NaN }, { a: Number.POSITIVE_INFINITY }, { a: cycle }, { a: [new Date()] }, { a: 10n }]) {
      expect(() => validatedCharacter(good({ values }))).toThrow();
    }
  });

  it('refuses values that serialize to more than a megabyte', () => {
    expect(() => validatedCharacter(good({ values: { text: 'x'.repeat(1_000_001) } }))).toThrow();
    expect(validatedCharacter(good({ values: { text: 'x'.repeat(900_000) } })).values.text).toHaveLength(900_000);
  });

  it('drops the keys an import never writes: markers, template, name, picture, and the ones Obsidian owns', () => {
    const values = { statblock: true, 'atlas-template': 'x', name: 'Z', image: 'i.png', atlasImport: {}, tags: ['t'], aliases: ['a'], cssclasses: ['c'], position: {}, hp: 10 };
    expect(validatedCharacter(good({ values })).values).toEqual({ hp: 10 });
  });

  it('never carries a __proto__, constructor or prototype key, at any depth', () => {
    const values = JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"hp":10,"nested":{"__proto__":{"x":1},"ok":1}}') as unknown;
    const clean = validatedCharacter(good({ values })).values;
    expect(Object.keys(clean)).toEqual(['hp', 'nested']);
    expect(Object.keys(clean.nested as object)).toEqual(['ok']);
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('gives the reason in the language of the app', () => {
    expect(() => validatedCharacter(good({ name: '' }))).toThrow('The importer gave the character no name.');
    setLocale('zh', TRANSLATIONS);
    expect(() => validatedCharacter(good({ name: '' }))).toThrow('导入器没有给出角色名称。');
  });
});

describe('a portrait Atlas keeps', () => {
  it('is a PNG, JPG or WebP of at most 20 MB', () => {
    expect(MAX_PORTRAIT_BYTES).toBe(20 * 1024 * 1024);
    expect(portraitProblem(PNG)).toBeNull();
    expect(portraitProblem(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0]).buffer)).toBe('unsupported');
    const big = new Uint8Array(MAX_PORTRAIT_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(portraitProblem(big.buffer)).toBe('tooBig');
  });
});
