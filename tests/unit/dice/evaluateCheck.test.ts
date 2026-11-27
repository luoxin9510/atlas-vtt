import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCheckRule } from '../../../src/app/dice/checkRules';
import { checkDirection, evaluateCheck } from '../../../src/app/dice/evaluateCheck';
import type { DiceRules } from '../../../src/app/types/diceRulesTypes';
import type { RollingDice } from '../../../src/app/types/diceSetTypes';
import type { RolledDie } from '../../../src/app/tools/diceFormula';

const die = (value: number, max: number): RolledDie => ({ die: `d${max}`, value, max });
const threeD6 = (crit: RollingDice['crit'], extra: Partial<RollingDice> = {}): RollingDice => ({ dice: [{ count: 3, sides: 6 }], crit, ...extra });
const d20Set = (crit: RollingDice['crit'], extra: Partial<RollingDice> = {}): RollingDice => ({ dice: [{ count: 1, sides: 20 }], crit, ...extra });

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((undo) => undo());
});

describe('checkDirection', () => {
  it('defaults to under for a roll-under set and over for any other', () => {
    expect(checkDirection(threeD6('roll-under'))).toBe('under');
    expect(checkDirection(d20Set('natural'))).toBe('over');
    expect(checkDirection(d20Set('none'))).toBe('over');
    expect(checkDirection({ defaultRoll: '1d100', crit: 'roll-under' })).toBe('under');
  });

  it('follows the set\'s check, which the written direction overrides', () => {
    expect(checkDirection(threeD6('none', { check: 'under' }))).toBe('under');
    expect(checkDirection(threeD6('roll-under', { check: 'over' }))).toBe('over');
    expect(checkDirection(threeD6('roll-under', { check: 'over' }), 'under')).toBe('under');
    expect(checkDirection(d20Set('natural'), 'under')).toBe('under');
  });
});

describe('the margin rule over every total', () => {
  const sets: DiceRules = { defaultRoll: '3d6', crit: 'none' };

  it.each([10, 14])('judges every 3d6 roll against a roll-under target of %i', (target) => {
    let rolls = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
      const total = a + b + c;
      const result = evaluateCheck({ rolling: sets, rolls: [die(a, 6), die(b, 6), die(c, 6)], total, target, written: 'under' });
      expect(result).toEqual({ target, direction: 'under', margin: target - total, success: total <= target, crit: null, rule: 'builtin:margin' });
      rolls++;
    }
    expect(rolls).toBe(216);
  });

  it('judges every d20+5 total against a roll-over target of 15', () => {
    const rolling: DiceRules = { defaultRoll: '1d20', crit: 'none' };
    for (let face = 1; face <= 20; face++) {
      const total = face + 5;
      const result = evaluateCheck({ rolling, rolls: [die(face, 20)], total, target: 15 });
      expect(result).toEqual({ target: 15, direction: 'over', margin: total - 15, success: total >= 15, crit: null, rule: 'builtin:margin' });
    }
  });
});

describe('criticals', () => {
  it('maps a natural 20 and a natural 1 and lets them decide', () => {
    const rolling = d20Set('natural');
    expect(evaluateCheck({ rolling, rolls: [die(20, 20)], total: 20, target: 40 })).toMatchObject({ success: true, crit: 'success', margin: -20 });
    expect(evaluateCheck({ rolling, rolls: [die(1, 20)], total: 11, target: 5 })).toMatchObject({ success: false, crit: 'failure', margin: 6 });
    expect(evaluateCheck({ rolling, rolls: [die(10, 20)], total: 10, target: 10 })).toMatchObject({ success: true, crit: null, margin: 0 });
  });

  it('maps the roll-under extremes: a 1 is a critical success, the highest face a failure', () => {
    const rolling: RollingDice = { dice: [{ count: 1, sides: 100 }], crit: 'roll-under' };
    expect(evaluateCheck({ rolling, rolls: [die(1, 100)], total: 1, target: 0 })).toMatchObject({ direction: 'under', success: true, crit: 'success' });
    expect(evaluateCheck({ rolling, rolls: [die(100, 100)], total: 100, target: 150 })).toMatchObject({ success: false, crit: 'failure', margin: 50 });
    expect(evaluateCheck({ rolling, rolls: [die(40, 100)], total: 40, target: 45 })).toMatchObject({ success: true, crit: null, margin: 5 });
  });

  it('has no critical where the set has none, or the roll has no default dice', () => {
    expect(evaluateCheck({ rolling: d20Set('none'), rolls: [die(20, 20)], total: 20, target: 25 })).toMatchObject({ success: false, crit: null });
    expect(evaluateCheck({ rolling: d20Set('natural'), rolls: [die(8, 8)], total: 8, target: 5 })).toMatchObject({ success: true, crit: null });
  });
});

describe('check rules by id', () => {
  const rolls = [die(10, 20)];

  it('runs a registered rule and names it', () => {
    cleanup.push(registerCheckRule('test:needs-margin-3', ({ margin }) => ({ success: margin >= 3, crit: null })));
    const rolling = d20Set('none', { checkRule: 'test:needs-margin-3' });
    expect(evaluateCheck({ rolling, rolls, total: 12, target: 10 })).toMatchObject({ success: false, rule: 'test:needs-margin-3' });
    expect(evaluateCheck({ rolling, rolls, total: 13, target: 10 })).toMatchObject({ success: true, rule: 'test:needs-margin-3' });
  });

  it('hands the rule the dice, the default dice, the crit and the direction', () => {
    let seen: unknown;
    cleanup.push(registerCheckRule('test:spy', (rule) => { seen = rule; return { success: true, crit: null }; }));
    const rolling = d20Set('natural', { checkRule: 'test:spy' });
    const all = [die(20, 20), die(3, 6)];
    evaluateCheck({ rolling, rolls: all, total: 23, target: 15 });
    expect(seen).toEqual({ total: 23, target: 15, direction: 'over', margin: 8, dice: all, defaultDice: [all[0]], diceCrit: 'high' });
  });

  it('falls back to the margin rule for an id nobody registered, and says so', () => {
    const rolling = d20Set('none', { checkRule: 'pack:unknown' });
    expect(evaluateCheck({ rolling, rolls, total: 10, target: 10 })).toMatchObject({ success: true, rule: 'builtin:margin' });
    expect(evaluateCheck({ rolling, rolls, total: 9, target: 10 })).toMatchObject({ success: false, rule: 'builtin:margin' });
  });

  it('falls back to the margin rule, naming it and logging the rule id once, when the rule throws', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup.push(() => logged.mockRestore());
    cleanup.push(registerCheckRule('test:throws', () => { throw new Error('boom'); }));
    const rolling = d20Set('none', { checkRule: 'test:throws' });
    expect(evaluateCheck({ rolling, rolls, total: 10, target: 10 })).toMatchObject({ success: true, rule: 'builtin:margin' });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain('test:throws');
  });

  it.each([
    ['a success that is no boolean', { success: 'yes', crit: null }],
    ['a crit that is no known value', { success: true, crit: 'big' }],
    ['a missing crit', { success: true }],
    ['no outcome at all', undefined],
  ])('falls back to the margin rule on %s', (_name, outcome) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup.push(() => logged.mockRestore());
    cleanup.push(registerCheckRule('test:bad', () => outcome as never));
    const rolling = d20Set('none', { checkRule: 'test:bad' });
    expect(evaluateCheck({ rolling, rolls, total: 9, target: 10 })).toMatchObject({ success: false, crit: null, rule: 'builtin:margin' });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('stops using a rule once it is unregistered', () => {
    const undo = registerCheckRule('test:gone', () => ({ success: true, crit: null }));
    const rolling = d20Set('none', { checkRule: 'test:gone' });
    expect(evaluateCheck({ rolling, rolls, total: 1, target: 10 }).rule).toBe('test:gone');
    undo();
    expect(evaluateCheck({ rolling, rolls, total: 1, target: 10 })).toMatchObject({ success: false, rule: 'builtin:margin' });
  });
});
