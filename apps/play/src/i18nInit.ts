import { getLocale, setLocale } from '../../../src/app/i18n/index.ts';
import { TRANSLATIONS } from '../../../src/app/i18n/languages.ts';
import { languageOf, readLanguageChoice, type ChoiceStorage } from '../../../src/app/i18n/languageChoice.ts';
import { browserStorage } from './browserStorage.ts';

/** Sets the language of every later `t()` call from the stored choice and the browser; returns the locale. */
export function initLanguage(storage: ChoiceStorage | null, browserLanguage: string): string {
  setLocale(languageOf(readLanguageChoice(storage), browserLanguage), TRANSLATIONS);
  return getLocale();
}

initLanguage(browserStorage(), navigator.language);
