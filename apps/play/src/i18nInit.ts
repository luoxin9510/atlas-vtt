import { setLocale } from '../../../src/app/i18n/index.ts';
import { TRANSLATIONS } from '../../../src/app/i18n/languages.ts';
import { languageOf, readLanguageChoice, type ChoiceStorage } from '../../../src/app/i18n/languageChoice.ts';
import { getLocale } from '../../../src/app/i18n/index.ts';

/** Sets the language of every later `t()` call from the stored choice and the browser; returns the locale. */
export function initLanguage(storage: ChoiceStorage | null, browserLanguage: string): string {
  setLocale(languageOf(readLanguageChoice(storage), browserLanguage), TRANSLATIONS);
  return getLocale();
}

function browserStorage(): ChoiceStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

initLanguage(browserStorage(), navigator.language);
