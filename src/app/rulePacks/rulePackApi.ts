/**
 * The interface Atlas offers to rule pack plugins (`plugin.rulePacks`): wait for Atlas to be ready,
 * register check rules, and roll dice or checks. Everything else a pack adds (system presets, statblock
 * templates, dice sets) it writes as vault files, as a user would; there is no API for it. The types
 * packs compile against are `docs/fork/rule-pack-api.d.ts`, kept in step with this one by a test.
 */

import type { App } from 'obsidian';
import { contestRuleIds, registerContestRule } from '../dice/contestRules';
import type { ContestRule } from '../dice/contestTypes';
import { checkRuleIds, registerCheckRule } from '../dice/checkRules';
import type { CheckDirection, CheckRule } from '../dice/checkTypes';
import { diceSetOfCollection } from '../services/diceSets/collectionDiceSets';
import { hideGmOnly } from '../dice/rollVisibility';
import { offlineDiceInputs } from '../services/offlineDiceInputs';
import { openMapDiceTool } from '../services/statblockRolls';
import { checkText } from '../tools/buildRoll';
import type { ContestNames } from '../tools/contestRoll';
import { rollContestFormulas, rollDiceFormula, rollingWith, type CheckOptions, type RollOptions } from '../tools/DiceTool';
import type { DiceRollResult } from '../types/diceTypes';

/** How a pack's roll is made. */
export interface RulePackRollOptions {
  /** Who sees the roll: `'gm'` keeps it from the player window and online players; unset is everyone. */
  visibility?: 'all' | 'gm' | undefined;
  /** For `rollCheck`: succeed on a total at most (`under`) or at least (`over`) the target; unset follows the dice set. */
  direction?: CheckDirection | undefined;
  /** Off the map only: the collection whose dice set rolls; unset rolls the default d20 set. */
  collectionId?: string | undefined;
}

/** How a pack's contest is rolled: the options of a roll, and who the two sides are. */
export interface RulePackContestOptions extends RulePackRollOptions {
  /** Names the two sides on the result card and in the log. */
  names?: ContestNames | undefined;
}

/** The workspace event Atlas triggers each time it is ready, with the fresh `RulePackApi` as its argument. */
export const RULE_PACKS_READY_EVENT = 'atlas-vtt:rule-packs-ready';

export interface RulePackApi {
  /** The version of this interface; it grows only by additions while it stays 1. */
  readonly apiVersion: 1;
  /** Resolves once Atlas has finished loading (settings, dice sets and views exist); never when Atlas unloads first. */
  whenReady(): Promise<void>;
  /**
   * Registers the rule `id` names (`checkRule` of a dice set or system). Ids starting with `builtin:` are
   * Atlas's own and refused with an error, so a pack never replaces `builtin:margin`; name yours
   * `<pack>:<rule>`. A rule of the same id replaces the earlier one. Returns the function that removes it;
   * Atlas removes whatever is left when it unloads.
   */
  registerCheckRule(id: string, rule: CheckRule): () => void;
  /** The ids of the registered check rules, Atlas's first. */
  checkRuleIds(): string[];
  /** Registers the rule `id` names (`contestRule` of a dice set or system), under the same rules as `registerCheckRule`. */
  registerContestRule(id: string, rule: ContestRule): () => void;
  /** The ids of the registered contest rules, Atlas's first. */
  contestRuleIds(): string[];
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

const BUILTIN_PREFIX = 'builtin:';

/** The options of the map's dice tool: only what was given, since an unset one is not the same as none. */
function mapOptions(options: RulePackRollOptions | undefined): RollOptions | undefined {
  return options?.visibility ? { visibility: options.visibility } : undefined;
}

/** Atlas's side of `RulePackApi`: one instance per plugin, told when Atlas is ready and when it unloads. */
export class RulePacks implements RulePackApi {
  readonly apiVersion = 1 as const;
  private readonly registrations = new Set<() => void>();
  private resolveReady: (() => void) | null = null;
  private readonly ready: Promise<void>;
  private disposed = false;

  constructor(private readonly app: App) {
    this.ready = new Promise<void>((resolve) => { this.resolveReady = resolve; });
  }

  /**
   * Called at the end of Atlas's load: packs waiting in `whenReady` go on, and the workspace event tells
   * packs to register again (a reloaded Atlas has a fresh interface). Once, and nothing after `dispose`.
   */
  markReady(): void {
    if (this.disposed || !this.resolveReady) return;
    this.resolveReady();
    this.resolveReady = null;
    this.app.workspace.trigger(RULE_PACKS_READY_EVENT, this);
  }

  /** Called when Atlas unloads: removes every rule a pack registered, and takes no more. */
  dispose(): void {
    this.disposed = true;
    // Newest first, so a rule is gone before the one it replaced
    for (const remove of [...this.registrations].reverse()) remove();
    this.registrations.clear();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  registerCheckRule(id: string, rule: CheckRule): () => void {
    return this.track('check', id, () => registerCheckRule(id, rule));
  }

  registerContestRule(id: string, rule: ContestRule): () => void {
    return this.track('contest', id, () => registerContestRule(id, rule));
  }

  /** Registers through `register` unless the id is Atlas's or empty (an error) or Atlas unloaded (nothing); disposal removes it. */
  private track(kind: string, id: string, register: () => () => void): () => void {
    if (typeof id !== 'string' || id === '' || id.startsWith(BUILTIN_PREFIX)) {
      throw new Error(`Rule pack ${kind} rule ids must be non-empty and must not start with "${BUILTIN_PREFIX}": ${String(id)}`);
    }
    if (this.disposed) return (): void => undefined;
    const remove = register();
    const forget = (): void => {
      remove();
      this.registrations.delete(forget);
    };
    this.registrations.add(forget);
    return forget;
  }

  checkRuleIds(): string[] {
    return checkRuleIds();
  }

  contestRuleIds(): string[] {
    return contestRuleIds();
  }

  rollDice(text: string, options?: RulePackRollOptions): DiceRollResult | null {
    const tool = openMapDiceTool(this.app);
    const asked = mapOptions(options);
    if (tool) return asked ? tool.rollDice(text, undefined, undefined, asked) : tool.rollDice(text);
    return this.rollOffMap(text, options);
  }

  rollCheck(formula: string, target: number, options?: RulePackRollOptions): DiceRollResult | null {
    if (!Number.isSafeInteger(target)) return null;
    const tool = openMapDiceTool(this.app);
    if (tool) {
      const asked: CheckOptions = { ...mapOptions(options), ...(options?.direction && { direction: options.direction }) };
      return tool.rollCheck(formula, target, asked);
    }
    return this.rollOffMap(checkText(formula, target, options?.direction), options);
  }

  rollContest(first: string, second: string, options?: RulePackContestOptions): [DiceRollResult, DiceRollResult] | null {
    const tool = openMapDiceTool(this.app);
    const names = options?.names;
    if (tool?.rollContest) return tool.rollContest(first, second, { ...mapOptions(options), ...(names && { names }) });
    const { rules, shown } = rollingWith(diceSetOfCollection(this.app, options?.collectionId ?? null), undefined);
    const inputs = offlineDiceInputs(this.app);
    const rolled = rollContestFormulas(first, second, rules, inputs, shown, names);
    if (rolled) for (const result of rolled) hideGmOnly(result, options?.visibility, inputs.gmOnly);
    return rolled;
  }

  /** Rolls with a collection's dice set, telling no map and showing nothing: no surface of Atlas's is reachable from here. */
  private rollOffMap(text: string, options: RulePackRollOptions | undefined): DiceRollResult | null {
    const { rules, shown } = rollingWith(diceSetOfCollection(this.app, options?.collectionId ?? null), undefined);
    const inputs = offlineDiceInputs(this.app);
    const result = rollDiceFormula(text, rules, inputs, shown);
    return result && hideGmOnly(result, options?.visibility, inputs.gmOnly);
  }
}
