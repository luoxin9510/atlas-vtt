import { en } from '../../../src/app/i18n/locales/en/index.ts';
import { resolveLocale, setLocale } from '../../../src/app/i18n/index.ts';
import { LAZY_TRANSLATIONS } from '../../../src/app/i18n/lazyLanguages.ts';
import { languageOf, readLanguageChoice, type ChoiceStorage } from '../../../src/app/i18n/languageChoice.ts';
import type { Translation } from '../../../src/app/i18n/types.ts';

/**
 * Sets the language of every later `t()` call from the stored choice and the browser, loading only that
 * language's chunk; returns the locale. A chunk that fails to load leaves the page in English.
 */
export async function initLanguage(
  storage: ChoiceStorage | null,
  browserLanguage: string,
  loaders: Readonly<Record<string, () => Promise<Translation>>> = LAZY_TRANSLATIONS,
): Promise<string> {
  const wanted = languageOf(readLanguageChoice(storage), browserLanguage);
  const known: Record<string, Translation> = { en };
  for (const code of Object.keys(loaders)) known[code] = en;
  const code = resolveLocale(wanted, known);
  const load = code === 'en' ? undefined : loaders[code];
  if (!load) {
    setLocale('en', { en });
    return 'en';
  }
  try {
    setLocale(code, { en, [code]: await load() });
    return code;
  } catch {
    setLocale('en', { en });
    return 'en';
  }
}
