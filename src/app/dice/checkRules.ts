/**
 * The check rule registry: a rule decides whether a check succeeded and
 * whether it is critical. Atlas ships `builtin:margin`; rule packs register
 * their own under ids of their choosing. Rules are looked up by the id a dice
 * set or system names (`checkRule`).
 */

import type { CheckRule } from './checkTypes';
import { ruleRegistry } from './ruleRegistry';

/** The default rule: success on a margin of 0 or more, criticals from the set's dice crit. */
export const MARGIN_RULE_ID = 'builtin:margin';

/** `builtin:margin`: succeeds when the margin is not negative; a critical result decides the check whatever the margin. */
export const marginRule: CheckRule = ({ margin, diceCrit }) => {
  if (diceCrit === 'high') return { success: true, crit: 'success' };
  if (diceCrit === 'low') return { success: false, crit: 'failure' };
  return { success: margin >= 0, crit: null };
};

const registry = ruleRegistry<CheckRule>(MARGIN_RULE_ID, marginRule);

/** Registers `rule` under `id`, replacing a rule of that id; returns the function that removes it again (see `RuleRegistry`). */
export const registerCheckRule = (id: string, rule: CheckRule): (() => void) => registry.register(id, rule);

/** The rule registered under `id`, or undefined when nobody registered it. */
export const checkRule = (id: string): CheckRule | undefined => registry.get(id);

/** The ids of all registered rules, built-ins first. */
export const checkRuleIds = (): string[] => registry.ids();
