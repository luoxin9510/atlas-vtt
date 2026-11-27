import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { checkRuleIds, MARGIN_RULE_ID } from '../../../src/app/dice/checkRules';
import { evaluateCheck } from '../../../src/app/dice/evaluateCheck';
import { contestRuleIds } from '../../../src/app/dice/contestRules';
import { evaluateContest } from '../../../src/app/dice/evaluateContest';
import { RulePacks, RULE_PACKS_READY_EVENT } from '../../../src/app/rulePacks/rulePackApi';
import type { DiceRollResult } from '../../../src/app/types/diceTypes';

vi.mock('../../../src/app/services/diceSets/collectionDiceSets', () => ({
  diceSetOfCollection: vi.fn(() => BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')),
}));

const rolling = { defaultRoll: '1d20', crit: 'none', checkRule: 'pack:always' } as const;
const check = (): ReturnType<typeof evaluateCheck> => evaluateCheck({ rolling, rolls: [], total: 5, target: 15 });

interface FakeMap {
  view: unknown;
  rolled: Array<{ kind: string; args: unknown[] }>;
}

/** An open map view whose dice tool records what it is asked to roll. */
function mapView(): FakeMap {
  const rolled: FakeMap['rolled'] = [];
  const result = { id: 'map', total: 9 } as DiceRollResult;
  const tool = {
    rollDice: (...args: unknown[]): DiceRollResult => { rolled.push({ kind: 'dice', args }); return result; },
    rollCheck: (...args: unknown[]): DiceRollResult => { rolled.push({ kind: 'check', args }); return result; },
    rollContest: (...args: unknown[]): [DiceRollResult, DiceRollResult] => { rolled.push({ kind: 'contest', args }); return [result, result]; },
  };
  const view = { containerEl: {}, serviceManager: { getToolController: () => ({ getDiceTool: () => tool }) } };
  return { view, rolled };
}

const triggered: Array<{ name: string; args: unknown[] }> = [];
const appWith = (...views: unknown[]): never => ({
  workspace: {
    getLeavesOfType: () => views.map((view) => ({ view })),
    trigger: (name: string, ...args: unknown[]): void => { triggered.push({ name, args }); },
  },
}) as never;

const cleanup: Array<() => void> = [];
afterEach(() => {
  triggered.length = 0;
  cleanup.splice(0).forEach((undo) => undo());
  vi.restoreAllMocks();
});

function packs(app: never = appWith()): RulePacks {
  const api = new RulePacks(app);
  cleanup.push(() => api.dispose());
  return api;
}

describe('the rule pack interface', () => {
  it('names its version', () => {
    expect(packs().apiVersion).toBe(1);
  });

  it('resolves whenReady only after Atlas has loaded', async () => {
    const api = packs();
    let ready = false;
    void api.whenReady().then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    api.markReady();
    await api.whenReady();
    expect(ready).toBe(true);
  });

  it('never resolves whenReady when Atlas unloads before it is ready', async () => {
    const api = packs();
    let ready = false;
    void api.whenReady().then(() => { ready = true; });
    api.dispose();
    api.markReady();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ready).toBe(false);
  });

  it('keeps whenReady resolved for a pack that asks later', async () => {
    const api = packs();
    api.markReady();
    await expect(api.whenReady()).resolves.toBeUndefined();
  });
});

describe('check rules from a pack', () => {
  it('decides checks while registered and falls back to the margin rule once removed', () => {
    const api = packs();
    const remove = api.registerCheckRule('pack:always', () => ({ success: true, crit: null }));
    expect(api.checkRuleIds()).toContain('pack:always');
    expect(check()).toMatchObject({ success: true, rule: 'pack:always' });
    remove();
    expect(api.checkRuleIds()).not.toContain('pack:always');
    expect(check()).toMatchObject({ success: false, rule: MARGIN_RULE_ID });
  });

  it('refuses ids Atlas reserves and leaves builtin:margin alone', () => {
    const api = packs();
    expect(() => api.registerCheckRule(MARGIN_RULE_ID, () => ({ success: true, crit: null }))).toThrow(/builtin:/);
    expect(() => api.registerCheckRule('builtin:mine', () => ({ success: true, crit: null }))).toThrow(/builtin:/);
    expect(() => api.registerCheckRule('', () => ({ success: true, crit: null }))).toThrow();
    expect(checkRuleIds()).not.toContain('builtin:mine');
    expect(evaluateCheck({ rolling: { defaultRoll: '1d20', crit: 'none' }, rolls: [], total: 20, target: 15 })).toMatchObject({ success: true, rule: MARGIN_RULE_ID });
  });

  it('drops a pack\'s rules when Atlas unloads, and takes none after', () => {
    const api = packs();
    api.registerCheckRule('pack:always', () => ({ success: true, crit: null }));
    api.dispose();
    expect(checkRuleIds()).not.toContain('pack:always');
    expect(check().rule).toBe(MARGIN_RULE_ID);
    const late = api.registerCheckRule('pack:late', () => ({ success: true, crit: null }));
    expect(checkRuleIds()).not.toContain('pack:late');
    expect(() => late()).not.toThrow();
  });
});

describe('removing a pack\'s rules', () => {
  it('leaves nothing behind when one pack registered the same id twice and Atlas unloads', () => {
    const api = packs();
    api.registerCheckRule('pack:twice', () => ({ success: true, crit: null }));
    api.registerCheckRule('pack:twice', () => ({ success: false, crit: null }));
    api.dispose();
    expect(checkRuleIds()).not.toContain('pack:twice');
  });

  it('never resurrects a rule that its pack removed, when the pack that replaced it removes its own', () => {
    const a = packs();
    const b = packs();
    const removeA = a.registerCheckRule('pack:shared', () => ({ success: true, crit: null }));
    const removeB = b.registerCheckRule('pack:shared', () => ({ success: false, crit: null }));
    removeA();
    removeB();
    expect(checkRuleIds()).not.toContain('pack:shared');
  });
});

describe('rolls from a pack', () => {
  it('rolls on the open map\'s dice tool, with the options', () => {
    const map = mapView();
    const api = packs(appWith(map.view));
    expect(api.rollDice('2d6', { visibility: 'gm' })?.id).toBe('map');
    expect(api.rollCheck('1d20+2', 14, { direction: 'under', visibility: 'gm' })?.id).toBe('map');
    expect(map.rolled[0]).toMatchObject({ kind: 'dice', args: ['2d6', undefined, undefined, { visibility: 'gm' }] });
    expect(map.rolled[1]).toMatchObject({ kind: 'check', args: ['1d20+2', 14, { direction: 'under', visibility: 'gm' }] });
  });

  it('rolls without a map by the default set, and judges a check', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const api = packs();
    const roll = api.rollDice('1d20+1');
    expect(roll).toMatchObject({ total: 12, formula: '1d20+1' });
    const judged = api.rollCheck('1d20', 11, { direction: 'under' });
    expect(judged?.check).toMatchObject({ target: 11, direction: 'under', margin: 0, success: true });
  });

  it('marks a GM-only roll without a map hidden, and a public one not', () => {
    const api = packs();
    expect(api.rollDice('1d20', { visibility: 'gm' })?.hidden).toBe(true);
    expect(api.rollDice('1d20', { visibility: 'all' })?.hidden).toBeUndefined();
    expect(api.rollCheck('1d20', 10, { visibility: 'gm' })?.hidden).toBe(true);
  });

  it('returns null for a formula it refuses, and for a target that is no whole number', () => {
    const api = packs();
    expect(api.rollDice('not dice')).toBeNull();
    expect(api.rollCheck('1d20', 1.5)).toBeNull();
  });
});

describe('the ready event', () => {
  it('names the event', () => {
    expect(RULE_PACKS_READY_EVENT).toBe('atlas-vtt:rule-packs-ready');
  });

  it('triggers it once when Atlas is ready, with the interface as the argument', () => {
    const api = packs();
    expect(triggered).toEqual([]);
    api.markReady();
    expect(triggered).toEqual([{ name: 'atlas-vtt:rule-packs-ready', args: [api] }]);
  });

  it('triggers it again for a reloaded Atlas, with the fresh interface', () => {
    const first = packs();
    first.markReady();
    first.dispose();
    const second = packs();
    second.markReady();
    expect(triggered.map((t) => t.args[0])).toEqual([first, second]);
  });

  it('does not trigger it when Atlas unloaded before it was ready', () => {
    const api = packs();
    api.dispose();
    api.markReady();
    expect(triggered).toEqual([]);
  });
});

describe('contest rules from a pack', () => {
  const sides = (): Parameters<typeof evaluateContest> => [
    { target: 10, direction: 'over', margin: 3, success: true, crit: null, rule: 'builtin:margin' },
    { target: 10, direction: 'over', margin: 1, success: true, crit: null, rule: 'builtin:margin' },
    { defaultRoll: '1d20', crit: 'none', contestRule: 'pack:second' },
  ];

  it('decides contests while registered, and falls back once removed', () => {
    const api = packs();
    const remove = api.registerContestRule('pack:second', () => ({ winner: 'second' }));
    expect(api.contestRuleIds()).toContain('pack:second');
    expect(evaluateContest(...sides())).toMatchObject({ winner: 'second', rule: 'pack:second' });
    remove();
    expect(api.contestRuleIds()).not.toContain('pack:second');
    expect(evaluateContest(...sides()).winner).toBe('first');
  });

  it('refuses ids Atlas reserves and empty ones', () => {
    const api = packs();
    expect(() => api.registerContestRule('builtin:contest-margin', () => ({ winner: null }))).toThrow(/builtin:/);
    expect(() => api.registerContestRule('builtin:mine', () => ({ winner: null }))).toThrow(/builtin:/);
    expect(() => api.registerContestRule('', () => ({ winner: null }))).toThrow();
    expect(contestRuleIds()).not.toContain('builtin:mine');
  });

  it('drops a pack\'s contest rules when Atlas unloads, newest first, and takes none after', () => {
    const api = packs();
    api.registerContestRule('pack:twice', () => ({ winner: 'first' }));
    api.registerContestRule('pack:twice', () => ({ winner: 'second' }));
    api.dispose();
    expect(contestRuleIds()).not.toContain('pack:twice');
    const late = api.registerContestRule('pack:late', () => ({ winner: null }));
    expect(contestRuleIds()).not.toContain('pack:late');
    expect(() => late()).not.toThrow();
  });
});

describe('rolling a contest from a pack', () => {
  it('rolls on the open map\'s dice tool, with the options', () => {
    const map = mapView();
    const api = packs(appWith(map.view));
    const rolled = api.rollContest('1d20 vs 12', '14', { visibility: 'gm', names: { first: 'A' } });
    expect(rolled).toHaveLength(2);
    expect(map.rolled[0]).toMatchObject({ kind: 'contest', args: ['1d20 vs 12', '14', { visibility: 'gm', names: { first: 'A' } }] });
  });

  it('rolls without a map: two linked checks and a verdict, shown to nobody', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const api = packs();
    const rolled = api.rollContest('1d20 vs 15', '1d20 vs 9', { names: { first: 'Ann', second: 'Bo' } });
    expect(rolled).not.toBeNull();
    const [one, two] = rolled ?? [];
    expect(one?.contest).toMatchObject({ side: 'first', names: { first: 'Ann', second: 'Bo' } });
    expect(two?.contest?.id).toBe(one?.contest?.id);
    expect(two?.contest?.verdict).toMatchObject({ winner: 'second' });
    expect(one?.hidden).toBeUndefined();
  });

  it('takes a bare target as the set\'s default roll against it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const rolled = packs().rollContest('12', '14');
    expect(rolled?.[0].check?.target).toBe(12);
    expect(rolled?.[1].check?.target).toBe(14);
  });

  it('marks both rolls of a GM-only contest hidden', () => {
    const rolled = packs().rollContest('1d20 vs 12', '1d20 vs 12', { visibility: 'gm' });
    expect(rolled?.[0].hidden).toBe(true);
    expect(rolled?.[1].hidden).toBe(true);
  });

  it('returns null, rolling nothing, for a side that is no check', () => {
    const api = packs();
    expect(api.rollContest('not dice', '12')).toBeNull();
    expect(api.rollContest('12', 'abc')).toBeNull();
  });
});
