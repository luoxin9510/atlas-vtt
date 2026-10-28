import { MAX_SCENE_ID } from './moves.ts';

/**
 * What this fork's own player app relies on, counted apart from upstream's `GM_LEVEL`. Raise it with
 * a line below whenever the GM sends the app something older apps cannot read.
 *
 * 1: `client` (the app declares its level) and `your-turn` (2026-10-26).
 */
export const FORK_PROTOCOL_LEVEL = 1;

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
