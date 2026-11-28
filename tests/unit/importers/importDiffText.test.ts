import { afterEach, describe, expect, it } from 'vitest';
import { changeText, diffImport } from '../../../src/app/importers/importDiff';
import type { FieldValue } from '../../../src/app/statblocks/model/templateTypes';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';

afterEach(() => setLocale('en', TRANSLATIONS));

const lines = (frontmatter: Record<string, FieldValue>, imported: Record<string, FieldValue>, keys: string[]): string[] =>
  diffImport(frontmatter, imported, keys).map(changeText);

describe('import diff lines', () => {
  it('writes one line per change', () => {
    expect(lines({ hp: 10 }, { hp: 12 }, ['hp'])).toEqual(['hp: 10 → 12']);
    expect(lines({}, { hp: 12 }, [])).toEqual(['hp: added 12']);
    expect(lines({ luck: 3 }, {}, ['luck'])).toEqual(['luck: removed']);
    expect(lines({ stats: { a: 1 } }, { stats: { a: 2 } }, ['stats'])).toEqual(['stats: changed']);
  });

  it('writes list changes as changed items, then added, then removed', () => {
    const before = { skills: [{ name: 'Broadsword', level: 15 }, { name: 'Axe', level: 10 }] };
    const after = { skills: [{ name: 'Broadsword', level: 16 }, { name: 'Shield', level: 11 }] };
    expect(lines(before, after, ['skills'])).toEqual(['skills: Broadsword 15 → 16, added Shield, and removed Axe']);
    expect(lines({}, { skills: ['Bow'] }, [])).toEqual(['skills: added Bow']);
  });

  it('is translated', () => {
    setLocale('zh', TRANSLATIONS);
    expect(lines({ hp: 10 }, { hp: 12 }, ['hp'])).toEqual(['hp：10 → 12']);
    expect(lines({ luck: 3 }, {}, ['luck'])).toEqual(['luck：已移除']);
  });
});
