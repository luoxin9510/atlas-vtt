import { requireApiVersion, type App } from 'obsidian';

/** The secret's id: neutral, so the public plugin may later share the same sign-in. */
export const ACCOUNT_SECRET_ID = 'atlas-account';

/** The host key's secret id: the key a self-hosted server gave the GM for making tables. */
export const HOST_KEY_SECRET_ID = 'atlas-host-key';

/** The first Obsidian with secret storage, which online play keeps the account token in. */
export const SECRET_STORAGE_VERSION = '1.11.4';

/** Where the account token is kept: per vault and per device, never in the plugin's data or any synced file. */
export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

/**
 * A secret kept in Obsidian's secret storage (1.11.4 and newer) under `id`. Its API has no delete, so a
 * cleared secret is an empty one. A device without secure storage reads as holding none, and `set` throws there.
 */
function secretStore(app: App, id: string, unavailable: string): TokenStore {
  // The version is written out, not `SECRET_STORAGE_VERSION`: the lint rule that allows `secretStorage` reads it from this call.
  if (requireApiVersion('1.11.4')) {
    const storage = app.secretStorage;
    return {
      get: () => {
        try {
          const secret = storage.getSecret(id);
          return secret === null || secret === '' ? null : secret;
        } catch {
          return null;
        }
      },
      set: (secret) => storage.setSecret(id, secret),
      clear: () => {
        try {
          storage.setSecret(id, '');
        } catch {
          // Nothing was kept where storage is not available.
        }
      },
    };
  }
  // An older Obsidian has nowhere safe to keep it: none is held, and keeping one fails.
  return {
    get: () => null,
    set: () => {
      throw new Error(unavailable);
    },
    clear: () => undefined,
  };
}

/** Where the account token is kept. */
export function secretTokenStore(app: App): TokenStore {
  return secretStore(app, ACCOUNT_SECRET_ID, `Signing in needs Obsidian ${SECRET_STORAGE_VERSION} or newer.`);
}

/** Where the host key of a self-hosted server is kept. */
export function secretHostKeyStore(app: App): TokenStore {
  return secretStore(app, HOST_KEY_SECRET_ID, `Keeping a host key needs Obsidian ${SECRET_STORAGE_VERSION} or newer.`);
}
