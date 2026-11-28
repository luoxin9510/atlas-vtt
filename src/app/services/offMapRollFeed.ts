import type { App } from 'obsidian';
import type { DiceRollOrigin } from '../types/diceRollOrigin';
import type { DiceRollResult } from '../types/diceTypes';

/** What a feed of the rolls made with no map open announces: the result, and who it was made for when known. */
export interface OffMapRollAnnounced {
  readonly result: DiceRollResult;
  readonly origin?: DiceRollOrigin | undefined;
}

/** The rolls made with no map open, as `OffMapRoller.onRoll` announces them. */
export interface OffMapRollFeed {
  /** Hears every roll made with no map open; returns what stops it. */
  onRoll(listener: (rolled: OffMapRollAnnounced) => void): () => void;
}

/**
 * Where `app`'s off-map rolls are heard. `OffMapRoller` provides itself for its app, so the table
 * shares them with players without importing the roller (and the dice sets, assets and settings it rolls with).
 */
const feeds = new WeakMap<App, OffMapRollFeed>();

/** Tells where `app`'s off-map rolls are heard; called by the app's roller. */
export function provideOffMapRollFeed(app: App, feed: OffMapRollFeed): void {
  feeds.set(app, feed);
}

/** Forgets the feed of `app`: its roller is gone. */
export function forgetOffMapRollFeed(app: App): void {
  feeds.delete(app);
}

/** The feed of `app`'s off-map rolls, or undefined where the app made no roller. */
export function offMapRollFeedOf(app: App): OffMapRollFeed | undefined {
  return feeds.get(app);
}
