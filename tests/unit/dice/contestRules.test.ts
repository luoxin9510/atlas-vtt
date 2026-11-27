import { afterEach, describe, expect, it } from 'vitest';
import { CONTEST_MARGIN_RULE_ID, contestMarginRule, contestRule, contestRuleIds, registerContestRule } from '../../../src/app/dice/contestRules';
import type { ContestRule } from '../../../src/app/dice/contestTypes';
import type { CheckResult } from '../../../src/app/dice/checkTypes';

const check = (margin: number, success = margin >= 0): CheckResult => ({ target: 10, direction: 'over', margin, success, crit: null, rule: 'builtin:margin' });

describe('builtin:contest-margin', () => {
  it('has its id', () => {
    expect(CONTEST_MARGIN_RULE_ID).toBe('builtin:contest-margin');
  });

  it('lets a success beat a failure, in either order', () => {
    expect(contestMarginRule({ first: check(0), second: check(-1) })).toEqual({ winner: 'first' });
    expect(contestMarginRule({ first: check(-1), second: check(0) })).toEqual({ winner: 'second' });
  });

  it('gives a success the win even against a failure of a bigger absolute margin', () => {
    expect(contestMarginRule({ first: check(1), second: check(-9) })).toEqual({ winner: 'first' });
  });

  it('gives two successes to the larger margin', () => {
    expect(contestMarginRule({ first: check(2), second: check(5) })).toEqual({ winner: 'second' });
    expect(contestMarginRule({ first: check(5), second: check(2) })).toEqual({ winner: 'first' });
  });

  it('gives two failures to the one that failed by less', () => {
    expect(contestMarginRule({ first: check(-2), second: check(-5) })).toEqual({ winner: 'first' });
    expect(contestMarginRule({ first: check(-5), second: check(-2) })).toEqual({ winner: 'second' });
  });

  it('ties on equal margins', () => {
    expect(contestMarginRule({ first: check(3), second: check(3) })).toEqual({ winner: null });
    expect(contestMarginRule({ first: check(-3), second: check(-3) })).toEqual({ winner: null });
  });

  it('follows the check verdict, not the sign of the margin, where a critical decided it', () => {
    expect(contestMarginRule({ first: check(-4, true), second: check(6, false) })).toEqual({ winner: 'first' });
  });
});

describe('the contest rule registry', () => {
  const firstWins: ContestRule = () => ({ winner: 'first' });
  const secondWins: ContestRule = () => ({ winner: 'second' });
  const cleanup: Array<() => void> = [];
  afterEach(() => cleanup.splice(0).forEach((undo) => undo()));

  it('has the margin rule built in', () => {
    expect(contestRule(CONTEST_MARGIN_RULE_ID)).toBe(contestMarginRule);
    expect(contestRuleIds()).toContain('builtin:contest-margin');
  });

  it('registers and unregisters a rule', () => {
    const undo = registerContestRule('test:first', firstWins);
    expect(contestRule('test:first')).toBe(firstWins);
    expect(contestRuleIds()).toContain('test:first');
    undo();
    expect(contestRule('test:first')).toBeUndefined();
    expect(contestRuleIds()).not.toContain('test:first');
  });

  it('lets the last registration decide and restores the one it replaced while that is still registered', () => {
    cleanup.push(registerContestRule('test:stack', firstWins));
    const undoSecond = registerContestRule('test:stack', secondWins);
    cleanup.push(undoSecond);
    expect(contestRule('test:stack')).toBe(secondWins);
    undoSecond();
    expect(contestRule('test:stack')).toBe(firstWins);
  });

  it('never brings back a rule that was removed', () => {
    const undoFirst = registerContestRule('test:gone', firstWins);
    const undoSecond = registerContestRule('test:gone', secondWins);
    undoFirst();
    expect(contestRule('test:gone')).toBe(secondWins);
    undoSecond();
    expect(contestRule('test:gone')).toBeUndefined();
  });
});
