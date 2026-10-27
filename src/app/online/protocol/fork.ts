import { MAX_SCENE_ID } from './moves.ts';

/**
 * What this fork's own player app relies on, counted apart from upstream's `GM_LEVEL`. Raise it with
 * a line below whenever the GM sends the app something older apps cannot read.
 *
 * 1: `client` (the app declares its level) and `your-turn` (2026-10-26).
 * 2: pause, asset-ticket, move-refused reason paused, asset-request via socket.
 */
export const FORK_PROTOCOL_LEVEL = 2;

/** The level from which a player is sent `your-turn`. */
export const YOUR_TURN_LEVEL = 1;

/** The level from which a player is sent `pause` (an explicit 2, never `FORK_PROTOCOL_LEVEL`). */
export const PAUSE_LEVEL = 2;

/** The level from which a player is sent `asset-ticket` (an explicit 2, never `FORK_PROTOCOL_LEVEL`). */
export const ASSET_TICKET_LEVEL = 2;

/** The name the fork's player app gives itself in `client`. */
export const FORK_APP = 'atlas-fork-play';

const MAX_APP_NAME = 64;
const MAX_FORK_LEVEL = 1000;

/** Sent by the player app right after every welcome: the fork level it speaks. A player who sent none has level 0. */
export interface PlayerClient {
  readonly t: 'client';
  readonly app: string;
  readonly forkLevel: number;
}

/** Sent to the player who owns a token of the scene `scene` that has just been given the turn. */
export interface YourTurnMessage {
  readonly t: 'your-turn';
  readonly scene: string;
}

/** A `client` message as the GM reads it, or null for anything malformed. */
export function parsePlayerClient(value: Record<string, unknown>): PlayerClient | null {
  const { app, forkLevel } = value;
  if (typeof app !== 'string' || app.length > MAX_APP_NAME) return null;
  if (typeof forkLevel !== 'number' || !Number.isInteger(forkLevel) || forkLevel < 0 || forkLevel > MAX_FORK_LEVEL) return null;
  return { t: 'client', app, forkLevel };
}

/** A `your-turn` message as the player app reads it, or null for anything malformed. */
export function parseYourTurn(value: Record<string, unknown>): YourTurnMessage | null {
  const { scene } = value;
  return typeof scene === 'string' && scene.length <= MAX_SCENE_ID ? { t: 'your-turn', scene } : null;
}

/** Sent to every level-2 player: the GM has paused the table (`paused`) or resumed it. */
export interface PauseMessage {
  readonly t: 'pause';
  readonly paused: boolean;
}

/** A short-lived download ticket for the image `hash`: `url` is a path on the relay, `expires` is epoch milliseconds. */
export interface AssetTicketMessage {
  readonly t: 'asset-ticket';
  readonly hash: string;
  readonly url: string;
  readonly expires: number;
}

/** `/api/assets/<hash>?t=<table code>.<player id>.<expiry ms>.<MAC>`; neither the code nor the id contains a dot. */
export const TICKET_URL_PATTERN = /^\/api\/assets\/[0-9a-f]{64}\?t=[a-z2-7]{26}\.[a-z2-7]{20}\.[0-9]{1,15}\.[A-Za-z0-9_-]{43}$/;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HASH_IN_URL = /^\/api\/assets\/([0-9a-f]{64})\?/;

/** A `pause` message as the player app reads it, or null for anything malformed. */
export function parsePause(value: Record<string, unknown>): PauseMessage | null {
  return typeof value.paused === 'boolean' ? { t: 'pause', paused: value.paused } : null;
}

/** An `asset-ticket` message as the player app reads it, or null for anything malformed. */
export function parseAssetTicket(value: Record<string, unknown>): AssetTicketMessage | null {
  const { hash, url, expires } = value;
  if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) return null;
  if (typeof url !== 'string' || !TICKET_URL_PATTERN.test(url) || HASH_IN_URL.exec(url)?.[1] !== hash) return null;
  if (typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires < 0) return null;
  return { t: 'asset-ticket', hash, url, expires };
}
