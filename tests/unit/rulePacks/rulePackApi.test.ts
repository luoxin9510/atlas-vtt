import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../../src/app/gameSystems/builtInDiceSets';
import { checkRuleIds, MARGIN_RULE_ID } from '../../../src/app/dice/checkRules';
import { evaluateCheck } from '../../../src/app/dice/evaluateCheck';
import { RulePacks } from '../../../src/app/rulePacks/rulePackApi';
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
  };
  const view = { containerEl: {}, serviceManager: { getToolController: () => ({ getDiceTool: () => tool }) } };
  return { view, rolled };
}

const appWith = (...views: unknown[]): never => ({
  workspace: { getLeavesOfType: () => views.map((view) => ({ view })) },
}) as never;

const cleanup: Array<() => void> = [];
afterEach(() => {
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
