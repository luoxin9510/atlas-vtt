/**
 * Which language Atlas speaks on this device: one the user picked, or Obsidian's. It is read
 * before any module builds its labels, when no plugin settings are loaded yet, so it lives in
 * the device's local storage, as Obsidian keeps its own language.
 */
export type LanguageChoice = 'zh' | 'en' | 'obsidian';

export const LANGUAGE_CHOICES: readonly LanguageChoice[] = ['zh', 'en', 'obsidian'];

/** This fork speaks Simplified Chinese until the user picks another language. */
export const DEFAULT_LANGUAGE_CHOICE: LanguageChoice = 'zh';

const STORAGE_KEY = 'atlas-vtt:language';

export type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isLanguageChoice(value: unknown): value is LanguageChoice {
  return LANGUAGE_CHOICES.includes(value as LanguageChoice);
}

export function readLanguageChoice(storage: ChoiceStorage | null): LanguageChoice {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return isLanguageChoice(stored) ? stored : DEFAULT_LANGUAGE_CHOICE;
  } catch {
    return DEFAULT_LANGUAGE_CHOICE;
  }
}

/** Keeps the choice for the next load; a storage that refuses it changes nothing. */
export function saveLanguageChoice(storage: ChoiceStorage | null, choice: LanguageChoice): void {
  try {
    storage?.setItem(STORAGE_KEY, choice);
  } catch {
    // The choice then holds for this session only
  }
}

/** The language code to speak: the chosen one, or Obsidian's (`getLanguage()`). */
export function languageOf(choice: LanguageChoice, obsidianLanguage: string): string {
  return choice === 'obsidian' ? obsidianLanguage : choice;
}
