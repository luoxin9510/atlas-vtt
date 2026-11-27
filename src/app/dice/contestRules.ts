/**
 * The contest rule registry: a rule decides which of two checks won. Atlas ships
 * `builtin:contest-margin`; rule packs register their own under ids of their choosing.
 * Rules are looked up by the id a dice set or system names (`contestRule`).
 */

import type { ContestRule } from './contestTypes';

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

/** What each id has registered, oldest first: the last one decides, and a removed one is gone for good. */
const rules = new Map<string, ContestRule[]>([[CONTEST_MARGIN_RULE_ID, [contestMarginRule]]]);

/**
 * Registers `rule` under `id`, replacing a rule of that id. Returns a function that removes it
 * again: the rule it replaced comes back only while it is still registered itself, so a rule
 * that was removed never returns, whatever the order of the removals.
 */
export function registerContestRule(id: string, rule: ContestRule): () => void {
  const stack = rules.get(id) ?? [];
  stack.push(rule);
  rules.set(id, stack);
  return (): void => {
    const at = stack.indexOf(rule);
    if (at >= 0) stack.splice(at, 1);
    if (stack.length === 0 && rules.get(id) === stack) rules.delete(id);
  };
}

/** The rule registered under `id`, or undefined when nobody registered it. */
export function contestRule(id: string): ContestRule | undefined {
  return rules.get(id)?.at(-1);
}

/** The ids of all registered rules, built-ins first. */
export function contestRuleIds(): string[] {
  return [...rules.keys()];
}
