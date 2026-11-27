import type { SharedRoll } from '../protocol/index.ts';
import { bareDieFaces } from '../../gameSystems/diceSets';
import { buildRoll, specOfText } from '../../tools/buildRoll';
import type { DiceRollResult } from '../../types/diceTypes';
import type { DiceRules } from '../../types/diceRulesTypes';
import type { AdvantageSide, RollingDice } from '../../types/diceSetTypes';
import { sharedRoll } from './RollShare.ts';

/** A number in [0, 1) from the cryptographic source. */
function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

/**
 * A formula rolled by a map's rules (its criticals and exploding dice) without a throw on anyone's
 * screen and without a line in the scene's roll history: for rolls in a message, and private rolls
 * Atlas's own player window must not show. It is rolled by the dice tool's own pipeline (`buildRoll`):
 * a formula without dice (`+2`) is added to the map's dice, `advantage` changes a roll of the set's dice
 * as the set's rule for the side says, and check text (`3d6 vs 10`) is judged, so the result carries
 * the same `check` as a tool roll. Null for an empty formula or one that does not parse, or that
 * advantage takes past the dice's limits.
 */
export function quietRollResult(formula: string, rules: DiceRules | RollingDice, id: string, now: number, random: () => number = cryptoRandom, setAppearance = false, advantage?: AdvantageSide): DiceRollResult | null {
  if (formula.trim() === '') return null;
  const body = buildRoll(specOfText(formula, bareDieFaces(rules)), rules, random, advantage, setAppearance);
  return 'ok' in body ? null : { id, timestamp: now, ...body };
}

/** `quietRollResult` as it travels to players; the check does not travel yet (the protocol carries none). */
export function quietRoll(formula: string, rules: DiceRules | RollingDice, id: string, now: number, random: () => number = cryptoRandom, setAppearance = false, advantage?: AdvantageSide): SharedRoll | null {
  const result = quietRollResult(formula, rules, id, now, random, setAppearance, advantage);
  return result === null ? null : sharedRoll(result);
}
