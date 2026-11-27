/**
 * The interface Atlas offers to rule pack plugins (`plugin.rulePacks`): wait for Atlas to be ready,
 * register check rules, and roll dice or checks. Everything else a pack adds (system presets, statblock
 * templates, dice sets) it writes as vault files, as a user would; there is no API for it. The types
 * packs compile against are `docs/fork/rule-pack-api.d.ts`, kept in step with this one by a test.
 */

import type { App } from 'obsidian';
import { checkRuleIds, registerCheckRule } from '../dice/checkRules';
import type { CheckDirection, CheckRule } from '../dice/checkTypes';
import { diceSetOfCollection } from '../services/diceSets/collectionDiceSets';
import { offlineDiceInputs } from '../services/offlineDiceInputs';
import { openMapDiceTool } from '../services/statblockRolls';
import { rollDiceFormula, rollingWith, type CheckOptions, type RollOptions } from '../tools/DiceTool';
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
  /**
   * Rolls dice text (`2d6+3`, or a check as `3d6 vs 10`). On the open map it rolls on that map's dice tool, so
   * the roll lands in its log and is thrown on the map. With no map open it rolls quietly with `collectionId`'s
   * dice set (else the default d20): nothing is shown, the result is yours to display. Null for text it refuses.
   */
  rollDice(text: string, options?: RulePackRollOptions): DiceRollResult | null;
  /** Rolls `formula` against a whole-number `target`, as `rollDice` does; null for a formula or target it refuses. */
  rollCheck(formula: string, target: number, options?: RulePackRollOptions): DiceRollResult | null;
}

const BUILTIN_PREFIX = 'builtin:';

/** The check text `formula` and `target` make: `vs` follows the dice set, `≤`/`≥` say the direction. */
function checkText(formula: string, target: number, direction: CheckDirection | undefined): string {
  return `${formula} ${direction === 'under' ? '≤' : direction === 'over' ? '≥' : 'vs'} ${target}`;
}

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

  /** Called at the end of Atlas's load: packs waiting in `whenReady` go on. Nothing after `dispose`. */
  markReady(): void {
    if (!this.disposed) this.resolveReady?.();
  }

  /** Called when Atlas unloads: removes every rule a pack registered, and takes no more. */
  dispose(): void {
    this.disposed = true;
    for (const remove of [...this.registrations]) remove();
    this.registrations.clear();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  registerCheckRule(id: string, rule: CheckRule): () => void {
    if (typeof id !== 'string' || id === '' || id.startsWith(BUILTIN_PREFIX)) {
      throw new Error(`Rule pack check rule ids must be non-empty and must not start with "${BUILTIN_PREFIX}": ${String(id)}`);
    }
    if (this.disposed) return (): void => undefined;
    const remove = registerCheckRule(id, rule);
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

  /** Rolls with a collection's dice set, telling no map and showing nothing: no surface of Atlas's is reachable from here. */
  private rollOffMap(text: string, options: RulePackRollOptions | undefined): DiceRollResult | null {
    const { rules, shown } = rollingWith(diceSetOfCollection(this.app, options?.collectionId ?? null), undefined);
    const result = rollDiceFormula(text, rules, offlineDiceInputs(), shown);
    if (result && options?.visibility === 'gm') result.hidden = true;
    return result;
  }
}
