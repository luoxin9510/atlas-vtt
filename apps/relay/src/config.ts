export interface RelayTiming {
  readonly knockWaitMs: number;
  readonly wrongCodeWindowMs: number;
  readonly wrongCodePauseMs: number;
  readonly unhostedTableMs: number;
  /** A socket that has not sent an accepted hello by then is closed 4006. */
  readonly helloTimeoutMs: number;
  /**
   * Liveness: every interval the relay pings each socket with a WebSocket ping frame (browsers answer
   * with a pong by themselves) and terminates one that has said nothing since the previous tick, so a
   * dead connection is gone within two intervals and frees its seat and its address slot.
   */
  readonly pingIntervalMs: number;
  /** A socket whose backlog of unsent bytes has not gone down for this long is closed 1013 (a slow reader keeps going). */
  readonly stallMs: number;
}

export interface RelayConfig {
  readonly hostKey: string;
  readonly host: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly maxPlayers: number;
  readonly statePath: string;
  readonly staticDir: string | null;
  readonly trustProxy: 'none' | 'xff' | 'cf';
  /** Hard cap on one socket's unsent bytes (memory protection): over it the socket is closed 1013 at once. */
  readonly maxBacklogBytes: number;
  /** Relay-wide cap on queued bytes of all sockets, a shared broadcast counted once (default 256 MiB); the largest backlog is closed 1013 when passed. */
  readonly maxTotalBacklogBytes?: number;
  readonly timing: RelayTiming;
  /** Where uploaded images are kept; default `assets` beside the state file. */
  readonly assetDir?: string;
  /** Most bytes one table may store (default 2 GiB). */
  readonly maxTableAssetBytes?: number;
  /** Most bytes all tables may store (default 10 GiB). */
  readonly maxServerAssetBytes?: number;
  /** Uploads are refused (507) while the disk has less free space (default 2 GiB). */
  readonly minFreeBytes?: number;
}

export const DEFAULT_TIMING: RelayTiming = {
  knockWaitMs: 180_000,
  wrongCodeWindowMs: 600_000,
  wrongCodePauseMs: 600_000,
  unhostedTableMs: 1_209_600_000,
  helloTimeoutMs: 10_000,
  pingIntervalMs: 30_000,
  stallMs: 30_000,
};

/** One whole asset (the largest, 64 MiB, in base64) plus slack. */
export const DEFAULT_MAX_BACKLOG_BYTES = 96 * 1024 * 1024;

const MIN_HOST_KEY_LENGTH = 24;

/**
 * An origin as the plugin writes it: http(s)://host[:port], lowercase, default port dropped, and no
 * path, query, fragment or credentials. Returns null for anything else.
 */
export function normalizeOrigin(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') return null;
  if (/[?#]/.test(text)) return null;
  return url.origin;
}

function integerIn(name: string, text: string | undefined, fallback: number, min: number, max: number): number {
  if (text === undefined || text === '') return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return value;
}

function trustProxyIn(text: string | undefined): RelayConfig['trustProxy'] {
  if (text === undefined || text === '' || text === 'none') return 'none';
  if (text === 'xff' || text === 'cf') return text;
  throw new Error('TRUST_PROXY must be none, xff or cf');
}

/** Reads the relay's settings from environment variables; throws an Error naming the bad one. */
export function loadConfig(env: NodeJS.ProcessEnv): RelayConfig {
  const hostKey = env.HOST_KEY ?? '';
  if (hostKey.length < MIN_HOST_KEY_LENGTH) throw new Error(`HOST_KEY is required and must be at least ${MIN_HOST_KEY_LENGTH} characters`);
  const publicOrigin = normalizeOrigin(env.PUBLIC_ORIGIN ?? '');
  if (publicOrigin === null) throw new Error('PUBLIC_ORIGIN is required and must look like https://play.example.com (no path)');
  return {
    hostKey,
    host: env.HOST || '127.0.0.1',
    port: integerIn('PORT', env.PORT, 8787, 0, 65535),
    publicOrigin,
    maxPlayers: integerIn('MAX_PLAYERS', env.MAX_PLAYERS, 8, 1, 12),
    statePath: env.STATE_PATH || './relay-state.json',
    staticDir: env.STATIC_DIR || null,
    trustProxy: trustProxyIn(env.TRUST_PROXY),
    maxBacklogBytes: DEFAULT_MAX_BACKLOG_BYTES,
    timing: DEFAULT_TIMING,
    ...(env.ASSET_DIR ? { assetDir: env.ASSET_DIR } : {}),
  };
}
