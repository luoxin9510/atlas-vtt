/**
 * Types for rule pack plugins that use Atlas's rule pack interface. Self-contained: copy this file
 * into your plugin. A test (`tests/unit/rulePacks/rulePackDeclaration.test.ts`) keeps it in step with
 * Atlas's own types (`src/app/rulePacks/rulePackApi.ts`).
 *
 * Getting the interface: Obsidian keeps loaded plugins by id, and the id differs between builds. The
 * repository's plugin id is `atlas-vtt`; a local install of this fork uses `atlas-vtt-fork`. Try both:
 *
 *     const plugins = (app as any).plugins.plugins;
 *     const atlas = plugins['atlas-vtt-fork'] ?? plugins['atlas-vtt'];
 *     const rulePacks: RulePackApi | undefined = atlas?.rulePacks;
 *     await rulePacks?.whenReady();
 *
 * Presets, statblock templates and dice sets have no API: a pack writes them as vault files, as a user
 * would. A pack's registrations end when Atlas unloads; register again after it loads.
 */

/** `under`: succeed on a total at most the target; `over`: at least the target. */
export type CheckDirection = 'under' | 'over';

/** The verdict on a roll made as a check. */
export interface CheckResult {
  target: number;
  direction: CheckDirection;
  /** Signed: >= 0 succeeded by that much, < 0 failed by that much. under: target - total; over: total - target. */
  margin: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** The rule that decided it (`builtin:margin` or a registered id). */
  rule: string;
}

/** One rolled die. */
export interface RolledDie {
  /** e.g. `d20`, or `dF` for a Fate die. */
  die: string;
  value: number;
  max: number;
  min?: number;
  negative?: true;
  exploded?: true;
  rerolled?: true;
  dropped?: true;
  success?: true;
  failure?: true;
  label?: string;
  name?: string;
  colour?: string;
  advantage?: true;
  sharedUnits?: true;
}

/** What a check rule is given. */
export interface CheckRuleInput {
  total: number;
  target: number;
  direction: CheckDirection;
  margin: number;
  dice: readonly RolledDie[];
  /** The dice the set's critical rule looks at; empty when the roll has none. */
  defaultDice: readonly RolledDie[];
  /** The set's own critical result of the roll (a natural 20, a roll-under 3): `'high'`, `'low'` or null. */
  diceCrit: 'high' | 'low' | null;
}

/** What a check rule decides. */
export interface CheckRuleOutcome {
  success: boolean;
  crit: 'success' | 'failure' | null;
}

/** Decides whether a check succeeded and whether it is critical. */
export type CheckRule = (input: CheckRuleInput) => CheckRuleOutcome;

/** A roll as Atlas returns it. Only the fields a pack usually needs are described closely. */
export interface DiceRollResult {
  id: string;
  timestamp: number;
  /** The formula rolled; the check text (`3d6 vs 10`) for a check. */
  formula: string;
  rolls: RolledDie[];
  /** The constants added to the dice. */
  modifiers: number;
  namedModifiers?: Array<{ label: string; value: number }>;
  total: number;
  linear?: false;
  crit?: 'high' | 'low' | null;
  /** The verdict where the roll was a check. */
  check?: CheckResult;
  diceSet?: { id: string; name: string };
  advantage?: 'advantage' | 'disadvantage';
  /** A GM-only roll. */
  hidden?: true;
  player?: string;
  source?: {
    type: 'toolbar' | 'statblock';
    tokenId?: string;
    statblockPath?: string;
    tokenName?: string;
    tokenImagePath?: string;
    abilityName?: string;
  };
}

/** How a pack's roll is made. */
export interface RulePackRollOptions {
  /** Who sees the roll: `'gm'` keeps it from the player window and online players; unset is everyone. */
  visibility?: 'all' | 'gm' | undefined;
  /** For `rollCheck`: succeed on a total at most (`under`) or at least (`over`) the target; unset follows the dice set. */
  direction?: CheckDirection | undefined;
  /** Off the map only: the collection whose dice set rolls; unset rolls the default d20 set. */
  collectionId?: string | undefined;
}

export interface RulePackApi {
  /** The version of this interface; it grows only by additions while it stays 1. */
  readonly apiVersion: 1;
  /** Resolves once Atlas has finished loading; never when Atlas unloads first. */
  whenReady(): Promise<void>;
  /**
   * Registers the rule `id` names (`checkRule` of a dice set or system). Ids starting with `builtin:` are
   * Atlas's own and refused with an error; name yours `<pack>:<rule>`. A rule of the same id replaces the
   * earlier one. Returns the function that removes it; Atlas removes whatever is left when it unloads.
   */
  registerCheckRule(id: string, rule: CheckRule): () => void;
  /** The ids of the registered check rules, Atlas's first. */
  checkRuleIds(): string[];
  /**
   * Rolls dice text (`2d6+3`, or a check as `3d6 vs 10`). On the open map it rolls on that map's dice tool, so
   * the roll lands in its log and is thrown on the map. With no map open it rolls quietly with `collectionId`'s
   * dice set (else the default d20): nothing is shown, the result is yours to display. Null for text it refuses.
   */
  rollDice(text: string, options?: RulePackRollOptions): DiceRollResult | null;
  /** Rolls `formula` against a whole-number `target`, as `rollDice` does; null for a formula or target it refuses. */
  rollCheck(formula: string, target: number, options?: RulePackRollOptions): DiceRollResult | null;
}
