/** Atlas's own table server, which a fork build never contacts unless its address is set to this. */
export const UPSTREAM_RELAY_ORIGIN = 'https://play.atlas-vtt.dev';

/** The Atlas account service, where the GM signs in; it exists only upstream. */
export const UPSTREAM_ACCOUNTS_ORIGIN = 'https://api.atlas-vtt.dev';

/** The account page on Atlas's website: invite keys are redeemed there, and the account's data is exported and deleted. */
export const UPSTREAM_ACCOUNT_PAGE_URL = 'https://atlas-vtt.dev/account';

const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

/**
 * The origin of a server address as `http(s)://host[:port]` (scheme and host lowercase, a default
 * port dropped), or null where the text is anything else: a path, query, fragment, credentials or
 * another scheme.
 */
export function normalizeServerOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!(url.protocol in DEFAULT_PORTS)) return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') return null;
  // `new URL('https://x.com?')` and `…#` keep an empty search or hash, so the text itself must end at the host.
  if (value.includes('?') || value.includes('#')) return null;
  return `${url.protocol}//${url.host}`;
}

let serverOrigin: string | null = null;

/** Sets the table server's origin, as `normalizeServerOrigin` made it; null: none is set. */
export function setServerOrigin(origin: string | null): void {
  serverOrigin = origin;
}

/** The table server's origin, or null where none is set (online play is then unavailable). */
export function relayOrigin(): string | null {
  return serverOrigin;
}

/** Whether a server other than Atlas's own is set; Atlas's account service is then never called. */
export function isSelfHosted(): boolean {
  return serverOrigin !== null && serverOrigin !== UPSTREAM_RELAY_ORIGIN;
}

/** Whether the server address is Atlas's own: the only case where its account service is contacted. */
export function isUpstream(): boolean {
  return serverOrigin === UPSTREAM_RELAY_ORIGIN;
}

/** The account service's origin; only reached where the server is not self-hosted. */
export function accountsOrigin(): string {
  return UPSTREAM_ACCOUNTS_ORIGIN;
}

/** The account page's address; only reached where the server is not self-hosted. */
export function accountPageUrl(): string {
  return UPSTREAM_ACCOUNT_PAGE_URL;
}
