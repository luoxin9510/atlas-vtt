import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult } from '../../../src/app/dice/checkTypes';
import { registerContestRule } from '../../../src/app/dice/contestRules';
import type { ContestRule } from '../../../src/app/dice/contestTypes';
import { evaluateContest } from '../../../src/app/dice/evaluateContest';
import type { DiceRules } from '../../../src/app/types/diceRulesTypes';
import type { RollingDice } from '../../../src/app/types/diceSetTypes';

const check = (margin: number): CheckResult => ({ target: 10, direction: 'over', margin, success: margin >= 0, crit: null, rule: 'builtin:margin' });
const set: RollingDice = { dice: [{ count: 3, sides: 6 }], crit: 'none' };
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((undo) => undo());
  vi.restoreAllMocks();
});

describe('evaluateContest', () => {
  it('uses the built-in rule where the set names none', () => {
    expect(evaluateContest(check(1), check(-1), set)).toEqual({ winner: 'first', rule: 'builtin:contest-margin' });
    expect(evaluateContest(check(2), check(2), { defaultRoll: '3d6', crit: 'none' } satisfies DiceRules)).toEqual({ winner: null, rule: 'builtin:contest-margin' });
  });

  it('uses the registered rule the set names, and reports its id', () => {
    cleanup.push(registerContestRule('test:second-always', () => ({ winner: 'second' })));
    expect(evaluateContest(check(5), check(-5), { ...set, contestRule: 'test:second-always' })).toEqual({ winner: 'second', rule: 'test:second-always' });
  });

  it('hands a rule copies, so a rule that changes them leaves the recorded results alone', () => {
    const rule: ContestRule = (input) => {
      (input.first as { success: boolean }).success = false;
      input.first.targetSteps?.push({ value: 99 });
      return { winner: 'second' };
    };
    cleanup.push(registerContestRule('test:mutates', rule));
    const first: CheckResult = { ...check(1), baseTarget: 10, targetSteps: [{ label: 'A', value: 1 }] };
    const second = check(-1);
    evaluateContest(first, second, { ...set, contestRule: 'test:mutates' });
    expect(first.success).toBe(true);
    expect(first.targetSteps).toEqual([{ label: 'A', value: 1 }]);
    expect(second).toEqual(check(-1));
  });

  it('falls back to the built-in rule for an id nobody registered, silently', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(evaluateContest(check(5), check(-5), { ...set, contestRule: 'test:missing' })).toEqual({ winner: 'first', rule: 'builtin:contest-margin' });
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back and logs once per rule where a rule throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: ContestRule = () => { throw new Error('boom'); };
    cleanup.push(registerContestRule('test:throws', broken));
    const rolling = { ...set, contestRule: 'test:throws' };
    expect(evaluateContest(check(5), check(-5), rolling)).toEqual({ winner: 'first', rule: 'builtin:contest-margin' });
    evaluateContest(check(5), check(-5), rolling);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('test:throws');
  });

  it.each([[undefined], [null], [{}], [{ winner: 'third' }], [{ winner: 1 }]])('falls back, logging once, where a rule answers %j', (answer) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const odd = (() => answer) as unknown as ContestRule;
    cleanup.push(registerContestRule('test:odd', odd));
    const rolling = { ...set, contestRule: 'test:odd' };
    expect(evaluateContest(check(-5), check(5), rolling)).toEqual({ winner: 'second', rule: 'builtin:contest-margin' });
    evaluateContest(check(-5), check(5), rolling);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('accepts a tie from a registered rule', () => {
    cleanup.push(registerContestRule('test:tie', () => ({ winner: null })));
    expect(evaluateContest(check(5), check(-5), { ...set, contestRule: 'test:tie' })).toEqual({ winner: null, rule: 'test:tie' });
  });
});
