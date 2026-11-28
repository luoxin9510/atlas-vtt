import type { DiceRollOrigin } from '../types/diceRollOrigin';
import type { DiceRollResult } from '../types/diceTypes';
import { withoutConstantLabels } from '../tools/namedModifiers';
import type { PreparedDiceRoll, RollSourcePresentation } from '../react/components/dice/diceSourcePresentation';

/** A token the players' picture shows, as a roll may name it: plain data read from the map. */
export interface ShownRollToken {
  readonly name: string | null;
  readonly imagePath: string | undefined;
  readonly showRing: boolean;
  readonly ringColor: string | undefined;
}

/** The scene a player window shows, as rolls ask it which tokens it shows. */
export interface PlayerRollSources {
  readonly viewId: string;
  readonly mapPath: string;
  /**
   * The shown tokens among `tokenIds` (every shown token without), read from the scene as
   * it is now. Empty once the view no longer holds `mapPath` loaded.
   */
  shownTokens(tokenIds?: readonly string[]): ReadonlyMap<string, ShownRollToken>;
}

/** Answers whether the shown scene shows the token a roll came from. */
export interface RollSceneLookup {
  shownToken(origin: DiceRollOrigin): ShownRollToken | null;
}

/** How the player window shows names and pictures. */
export interface PlayerRollView {
  /** Whether players see token names (the player view's nameplate setting). */
  showNames: boolean;
  /** A displayable address of a vault image, or null when it cannot be shown. */
  imageSrc(path: string): string | null;
}

/**
 * A roll as the player window shows it. It names its token, with the token's name and
 * picture on the map and the ability rolled, only when its origin names that token and
 * the shown scene shows it. Otherwise players see the dice and the total and nothing of
 * who rolled or what for, nor who the sides of a contest are. The roll itself is never changed: the
 * GM's window and the log keep it whole.
 */
export function rollForPlayers(
  full: DiceRollResult,
  origin: DiceRollOrigin | undefined,
  scene: RollSceneLookup | null,
  view: PlayerRollView,
): PreparedDiceRoll {
  const result = withoutSideNames(full);
  const source = result.source;
  // A roll with no source names no token, so no token is shown: its labels may still come from a statblock's armed values.
  if (!source) return { result: withoutLabels(result), sourcePresentation: null };
  const shown = origin && source.tokenId && origin.tokenId === source.tokenId ? scene?.shownToken(origin) ?? null : null;
  if (!shown) return { result: { ...withoutLabels(result), source: { type: source.type } }, sourcePresentation: null };
  return {
    result: { ...result, source: source.abilityName ? { type: source.type, abilityName: source.abilityName } : { type: source.type } },
    sourcePresentation: presentationOf(shown, view),
  };
}

/** Labels name abilities and armed values of the token: without that token the labels go (modifiers, formula, steps), the values stay. */
function withoutLabels(result: DiceRollResult): DiceRollResult {
  const { namedModifiers, ...rest } = withoutStepLabels(result);
  if (namedModifiers === undefined) return rest;
  return { ...rest, formula: withoutConstantLabels(rest.formula) };
}

/** The labels of a moved target's steps name abilities and armed values of the token: without that token they go, the values stay. */
function withoutStepLabels(result: DiceRollResult): DiceRollResult {
  const steps = result.check?.targetSteps;
  if (!result.check || !steps) return result;
  return { ...result, check: { ...result.check, targetSteps: steps.map(({ value }) => ({ value })) } };
}

/** A contest's sides are named after statblocks and tokens, which players are not told: they see "First side" / "Second side". */
function withoutSideNames(result: DiceRollResult): DiceRollResult {
  if (result.contest?.names === undefined) return result;
  const { names: _names, ...contest } = result.contest;
  return { ...result, contest };
}

function presentationOf(shown: ShownRollToken, view: PlayerRollView): RollSourcePresentation {
  const src = shown.imagePath ? view.imageSrc(shown.imagePath) : null;
  return {
    name: view.showNames ? shown.name : null,
    avatar: src ? { src, showRing: shown.showRing, ringColor: shown.ringColor } : null,
  };
}
