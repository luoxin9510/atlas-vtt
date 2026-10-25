import type { ChoiceStorage } from '../../i18n/languageChoice';

/** The device's local storage, or null where the webview refuses it. */
export function deviceStorage(): ChoiceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
