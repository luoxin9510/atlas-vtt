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
 * would. A pack's registrations end when Atlas unloads; register again after it loads: Atlas triggers the
 * workspace event `RULE_PACKS_READY_EVENT` each time it is ready, with a fresh `RulePackApi` as the argument
 * (the object of a reloaded Atlas is a new one):
 *
 *     this.registerEvent((app.workspace as any).on('atlas-vtt:rule-packs-ready', (api: RulePackApi) => register(api)));
 *
 * `apiVersion` stays 1 as the interface grows by additions; test for a member (`typeof api.rollContest === 'function'`).
 */

/** The workspace event Atlas triggers each time it is ready, with the fresh `RulePackApi` as its argument. */
export declare const RULE_PACKS_READY_EVENT: 'atlas-vtt:rule-packs-ready';

/** `under`: succeed on a total at most the target; `over`: at least the target. */
export type CheckDirection = 'under' | 'over';

/** One thing that moved a check's target: a named armed bonus, a one-off modifier, or an unnamed number. */
export interface TargetStep {
  label?: string;
  value: number;
}

/** The verdict on a roll made as a check. */
export interface CheckResult {
  /** The target the check was judged against: where the steps, if any, left it. */
  target: number;
  direction: CheckDirection;
  /** Signed: >= 0 succeeded by that much, < 0 failed by that much. under: target - total; over: total - target. */
  margin: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** The rule that decided it (`builtin:margin` or a registered id). */
  rule: string;
  /** Where the target stood before `targetSteps` moved it; set only with them. */
  baseTarget?: number;
  /** What moved the target (modifiers on a check that goes under), in the order applied; set only where something did. */
  targetSteps?: TargetStep[];
}

/** Which of the two checks of a contest: the one written first, or second. */
export type ContestSide = 'first' | 'second';

/** Who won a contest (null: a tie) and the rule that decided it. */
export interface ContestVerdict {
  winner: ContestSide | null;
  /** The rule that decided it (`builtin:contest-margin` or a registered id). */
  rule: string;
}

/** The two judged checks a contest rule decides between. */
export interface ContestRuleInput {
  first: CheckResult;
  second: CheckResult;
}

/** What a contest rule decides: the winner, or null for a tie. */
export interface ContestRuleOutcome {
  winner: ContestSide | null;
}

/** Decides which of two checks won. */
export type ContestRule = (input: ContestRuleInput) => ContestRuleOutcome;

/** What marks a roll as one side of a contest; the verdict is on the second result only. */
export interface RollContest {
  /** Shared by both rolls of the contest. */
  id: string;
  side: ContestSide;
  names?: { first?: string; second?: string };
  verdict?: ContestVerdict;
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
  /** Set where the roll is one side of a contest (`rollContest`). */
  contest?: RollContest;
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
  /** Who sees the roll: `'gm'` keeps it from the player window and online players, `'all'` shows it to everyone; unset, the GM's GM-only switch decides. */
  visibility?: 'all' | 'gm' | undefined;
  /** For `rollCheck`: succeed on a total at most (`under`) or at least (`over`) the target; unset follows the dice set. */
  direction?: CheckDirection | undefined;
  /** Off the map only: the collection whose dice set rolls; unset rolls the default d20 set. */
  collectionId?: string | undefined;
}

/** How a pack's contest is rolled: the options of a roll, and who the two sides are. */
export interface RulePackContestOptions extends RulePackRollOptions {
  /** Names the two sides on the result card and in the log. */
  names?: { first?: string | undefined; second?: string | undefined } | undefined;
}

/** A value of a statblock field: text, a number, a flag, nothing, a list of values or a record of them. */
export type FieldValue = string | number | boolean | null | FieldValue[] | { [key: string]: FieldValue };

/** A parsed character file: what an importer hands to Atlas. */
export interface ImportedCharacter {
  /** The character's name: the note's name and its statblock's. */
  name: string;
  /** The id of the statblock template the values are written for. */
  templateId: string;
  /** The statblock's values by field key. */
  values: Record<string, FieldValue>;
  /** The portrait as the file holds it; Atlas keeps PNG, JPG and WebP and imports without one otherwise. */
  portrait?: { bytes: ArrayBuffer };
}

/** A character file importer a pack registers. */
export interface CharacterImporter {
  /** The registration id, `<pack>:<importer>`; `builtin:` ids are Atlas's own and refused. */
  id: string;
  /** What the importer is called where Atlas names it (the file picker, the summary). */
  label: string;
  /** The file extensions it reads, without the dot, in any case. At least one. */
  extensions: string[];
  /** Reads one file; may be async. A throw fails that file only, with its message in the summary. */
  parse(bytes: ArrayBuffer, fileName: string): ImportedCharacter | Promise<ImportedCharacter>;
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
  /** Registers the rule `id` names (`contestRule` of a dice set or system), under the same rules as `registerCheckRule`. */
  registerContestRule(id: string, rule: ContestRule): () => void;
  /** The ids of the registered contest rules, Atlas's first. */
  contestRuleIds(): string[];
  /**
   * Registers a character file importer: `parse(bytes, fileName)` reads a file of one of `extensions` (without
   * the dot, any case) into a name, a template id, field values and an optional portrait. Under the same rules
   * as `registerCheckRule` (no empty or `builtin:` id; the latest registration of an id wins; returns the
   * function that removes it; Atlas removes what is left when it unloads), and it needs a `label`, a `parse`
   * and at least one extension. Atlas then offers the "Import character file..." command for those extensions:
   * it creates a statblock note (with an import record) in the collection's `characters/` folder and a token
   * from the portrait, and offers re-import.
   */
  registerImporter(importer: CharacterImporter): () => void;
  /** The ids of the registered importers. */
  importerIds(): string[];
  /**
   * Rolls dice text (`2d6+3`, or a check as `3d6 vs 10`). On the open map it rolls on that map's dice tool, so
   * the roll lands in its log and is thrown on the map. With no map open it rolls quietly with `collectionId`'s
   * dice set (else the default d20): nothing is shown, the result is yours to display. Null for text it refuses.
   */
  rollDice(text: string, options?: RulePackRollOptions): DiceRollResult | null;
  /** Rolls `formula` against a whole-number `target`, as `rollDice` does; null for a formula or target it refuses. */
  rollCheck(formula: string, target: number, options?: RulePackRollOptions): DiceRollResult | null;
  /**
   * Rolls two checks against each other, each a check (`3d6 vs 12`) or a bare target (`12`, the set's default
   * roll against it): both results, the second carrying the verdict in `contest`. Routed as `rollCheck` is.
   * Null, with nothing rolled, where a side is no check.
   */
  rollContest(first: string, second: string, options?: RulePackContestOptions): [DiceRollResult, DiceRollResult] | null;
}
