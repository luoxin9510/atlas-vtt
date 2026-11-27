/**
 * A registry of rules by id, for the rule kinds a rule pack can add to (check rules, contest rules).
 * Each id keeps a stack: the last registered rule decides, and a removed one is gone for good.
 */

export interface RuleRegistry<R> {
  /**
   * Registers `rule` under `id`, replacing a rule of that id. Returns a function that removes it
   * again: the rule it replaced comes back only while it is still registered itself, so a rule
   * that was removed never returns, whatever the order of the removals.
   */
  register(id: string, rule: R): () => void;
  /** The rule registered under `id`, or undefined when nobody registered it. */
  get(id: string): R | undefined;
  /** The ids of all registered rules, built-ins first. */
  ids(): string[];
}

/** A registry that starts with `builtIn` under `builtInId`. */
export function ruleRegistry<R>(builtInId: string, builtIn: R): RuleRegistry<R> {
  const rules = new Map<string, R[]>([[builtInId, [builtIn]]]);
  return {
    register(id, rule) {
      const stack = rules.get(id) ?? [];
      stack.push(rule);
      rules.set(id, stack);
      return (): void => {
        const at = stack.indexOf(rule);
        if (at >= 0) stack.splice(at, 1);
        if (stack.length === 0 && rules.get(id) === stack) rules.delete(id);
      };
    },
    get: (id) => rules.get(id)?.at(-1),
    ids: () => [...rules.keys()],
  };
}
