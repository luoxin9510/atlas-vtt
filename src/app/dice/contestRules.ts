/**
 * The contest rule registry: a rule decides which of two checks won. Atlas ships
 * `builtin:contest-margin`; rule packs register their own under ids of their choosing.
 * Rules are looked up by the id a dice set or system names (`contestRule`).
 */

import type { ContestRule } from './contestTypes';
import { ruleRegistry } from './ruleRegistry';

/** The default rule: a success beats a failure, else the larger margin wins. */
export const CONTEST_MARGIN_RULE_ID = 'builtin:contest-margin';

/**
 * `builtin:contest-margin`: a success beats a failure; otherwise the larger margin wins (of two
 * failures the one that failed by less); equal margins tie.
 */
export const contestMarginRule: ContestRule = ({ first, second }) => {
  if (first.success !== second.success) return { winner: first.success ? 'first' : 'second' };
  if (first.margin === second.margin) return { winner: null };
  return { winner: first.margin > second.margin ? 'first' : 'second' };
};

const registry = ruleRegistry<ContestRule>(CONTEST_MARGIN_RULE_ID, contestMarginRule);

/** Registers `rule` under `id`, replacing a rule of that id; returns the function that removes it again (see `RuleRegistry`). */
export const registerContestRule = (id: string, rule: ContestRule): (() => void) => registry.register(id, rule);

/** The rule registered under `id`, or undefined when nobody registered it. */
export const contestRule = (id: string): ContestRule | undefined => registry.get(id);

/** The ids of all registered rules, built-ins first. */
export const contestRuleIds = (): string[] => registry.ids();
