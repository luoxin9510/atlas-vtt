import { afterEach, describe, expect, it } from 'vitest';
import { MARGIN_RULE_ID, checkRule, checkRuleIds, marginRule, registerCheckRule } from '../../../src/app/dice/checkRules';
import type { CheckRule, CheckRuleInput } from '../../../src/app/dice/checkTypes';

const input = (over: Partial<CheckRuleInput> = {}): CheckRuleInput => ({
  total: 10, target: 10, direction: 'under', margin: 0, dice: [], defaultDice: [], diceCrit: null, ...over,
});

const always: CheckRule = () => ({ success: true, crit: null });
const never: CheckRule = () => ({ success: false, crit: null });
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((undo) => undo());
});

describe('the margin rule', () => {
  it('succeeds on a margin of 0 or more', () => {
    expect(marginRule(input({ margin: 0 }))).toEqual({ success: true, crit: null });
    expect(marginRule(input({ margin: 5 }))).toEqual({ success: true, crit: null });
    expect(marginRule(input({ margin: -1 }))).toEqual({ success: false, crit: null });
  });

  it('maps the dice crit and lets it decide the check', () => {
    expect(marginRule(input({ margin: -9, diceCrit: 'high' }))).toEqual({ success: true, crit: 'success' });
    expect(marginRule(input({ margin: 9, diceCrit: 'low' }))).toEqual({ success: false, crit: 'failure' });
  });
});

describe('the registry', () => {
  it('has the margin rule built in', () => {
    expect(checkRule(MARGIN_RULE_ID)).toBe(marginRule);
    expect(checkRuleIds()).toContain('builtin:margin');
  });

  it('registers and unregisters a rule', () => {
    const undo = registerCheckRule('test:always', always);
    expect(checkRule('test:always')).toBe(always);
    expect(checkRuleIds()).toContain('test:always');
    undo();
    expect(checkRule('test:always')).toBeUndefined();
    expect(checkRuleIds()).not.toContain('test:always');
  });

  it('brings back the rule a registration replaced', () => {
    cleanup.push(registerCheckRule('test:swap', always));
    const undo = registerCheckRule('test:swap', never);
    expect(checkRule('test:swap')).toBe(never);
    undo();
    expect(checkRule('test:swap')).toBe(always);
  });

  it('ignores an unregister after another rule took the id', () => {
    const first = registerCheckRule('test:taken', always);
    cleanup.push(registerCheckRule('test:taken', never));
    first();
    expect(checkRule('test:taken')).toBe(never);
  });

  it('does not know an id nobody registered', () => {
    expect(checkRule('test:missing')).toBeUndefined();
  });
});
