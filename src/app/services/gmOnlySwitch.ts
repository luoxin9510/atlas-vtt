import type { App } from 'obsidian';

/**
 * The GM's GM-only switch (setting `rollsGmOnly`) as a dice tool reads it. `SettingsService` provides
 * it for its app, so the dice code reads the switch without importing the settings (and their chain).
 */
const readers = new WeakMap<App, () => boolean>();

/** Tells where `app`'s switch is read; called by the settings of that app. */
export function provideGmOnlySwitch(app: App, read: () => boolean): void {
  readers.set(app, read);
}

/** Reads the switch of `app` at each call: off where the app has no settings. */
export function gmOnlySwitchOf(app: App | undefined): () => boolean {
  return (): boolean => (app ? readers.get(app)?.() === true : false);
}
