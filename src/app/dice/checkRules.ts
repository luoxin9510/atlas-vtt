/**
 * The check rule registry: a rule decides whether a check succeeded and
 * whether it is critical. Atlas ships `builtin:margin`; rule packs register
 * their own under ids of their choosing. Rules are looked up by the id a dice
 * set or system names (`checkRule`).
 */

import type { CheckRule } from './checkTypes';

/** The default rule: success on a margin of 0 or more, criticals from the set's dice crit. */
export const MARGIN_RULE_ID = 'builtin:margin';

/** `builtin:margin`: succeeds when the margin is not negative; a critical result decides the check whatever the margin. */
export const marginRule: CheckRule = ({ margin, diceCrit }) => {
  if (diceCrit === 'high') return { success: true, crit: 'success' };
  if (diceCrit === 'low') return { success: false, crit: 'failure' };
  return { success: margin >= 0, crit: null };
};

const rules = new Map<string, CheckRule>([[MARGIN_RULE_ID, marginRule]]);

/**
 * Registers `rule` under `id`, replacing a rule of that id. Returns a function that removes it
 * again (the rule it replaced, if any, comes back); calling it after another rule took the id
 * does nothing.
 */
export function registerCheckRule(id: string, rule: CheckRule): () => void {
  const previous = rules.get(id);
  rules.set(id, rule);
  return (): void => {
    if (rules.get(id) !== rule) return;
    if (previous) rules.set(id, previous);
    else rules.delete(id);
  };
}

/** The rule registered under `id`, or undefined when nobody registered it. */
export function checkRule(id: string): CheckRule | undefined {
  return rules.get(id);
}

/** The ids of all registered rules, built-ins first. */
export function checkRuleIds(): string[] {
  return [...rules.keys()];
}
