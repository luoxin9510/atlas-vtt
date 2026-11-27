/** Running a rule a pack registered: what it answers is checked, and a rule that fails is logged once. */

/** Rules that failed and were logged: each is logged once, not on every roll it judges. */
const failedRules = new WeakSet<object>();

function logFailure(rule: object, message: string, error?: unknown): void {
  if (failedRules.has(rule)) return;
  failedRules.add(rule);
  if (error === undefined) console.error(message);
  else console.error(message, error);
}

/**
 * What a pack's rule decided: its answer where `accept` takes it as valid (returning the outcome to
 * use), else null (logged once per rule, with its id, where it threw or answered something else).
 * `kind` names the rule kind in the log ("Check", "Contest").
 */
export function runPackRule<I, O>(
  kind: string, id: string, rule: (input: I) => unknown, input: I, accept: (outcome: unknown) => O | null,
): O | null {
  try {
    const outcome = accept(rule(input));
    if (outcome !== null) return outcome;
    logFailure(rule, `[Atlas] ${kind} rule "${id}" returned no valid outcome; the margin rule decided instead.`);
  } catch (error) {
    logFailure(rule, `[Atlas] ${kind} rule "${id}" threw; the margin rule decided instead.`, error);
  }
  return null;
}
