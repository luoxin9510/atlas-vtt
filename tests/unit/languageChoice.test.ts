import { describe, expect, it } from 'vitest';
import { languageOf, readLanguageChoice, saveLanguageChoice } from '../../src/app/i18n/languageChoice';

/** A `Storage` that keeps its items in a map. */
function memoryStorage(items: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(items));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('the language Atlas speaks', () => {
  it('is Chinese until a choice is saved', () => {
    expect(readLanguageChoice(memoryStorage())).toBe('zh');
    expect(readLanguageChoice(null)).toBe('zh');
    expect(languageOf(readLanguageChoice(memoryStorage()), 'en')).toBe('zh');
  });

  it('is the saved choice, or Obsidian\'s language when that is the choice', () => {
    const storage = memoryStorage();
    saveLanguageChoice(storage, 'en');
    expect(languageOf(readLanguageChoice(storage), 'zh')).toBe('en');
    saveLanguageChoice(storage, 'obsidian');
    expect(languageOf(readLanguageChoice(storage), 'ru')).toBe('ru');
  });

  it('ignores a stored value it does not know, and storage that throws', () => {
    expect(readLanguageChoice(memoryStorage({ 'atlas-vtt:language': 'klingon' }))).toBe('zh');
    const broken = { getItem: (): string | null => { throw new Error('denied'); }, setItem: (): void => { throw new Error('denied'); } };
    expect(readLanguageChoice(broken)).toBe('zh');
    expect(() => saveLanguageChoice(broken, 'en')).not.toThrow();
  });
});
