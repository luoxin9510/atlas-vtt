import { describe, expect, it } from 'vitest';
import { sameDiceRules } from '../../../src/app/gameSystems/diceRules';
import { parseStoredDiceSet } from '../../../src/app/gameSystems/diceSetValidation';
import { diceRulesOfSet, rollingRules, sameRolling } from '../../../src/app/gameSystems/diceSets';
import { parseUserPresets } from '../../../src/app/gameSystems/presetValidation';

const stored = { format: 1, id: 'set-3d6', name: 'Three d6', dice: [{ count: 3, sides: 6 }], crit: 'roll-under' };
const base = { defaultRoll: '3d6', crit: 'roll-under' };
const preset = (dice: Record<string, unknown>): Record<string, unknown> => ({
  id: `c-${JSON.stringify(dice)}`,
  name: `C ${JSON.stringify(dice)}`,
  rules: { gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric' }, conditions: [], dice },
});

describe('contestRule of a dice set', () => {
  it('is read and kept, an unknown id included, trimmed', () => {
    expect(parseStoredDiceSet({ ...stored, contestRule: ' pack:duel ' })?.contestRule).toBe('pack:duel');
    expect(parseStoredDiceSet({ ...stored, contestRule: 'builtin:contest-margin' })?.contestRule).toBe('builtin:contest-margin');
  });

  it('is left out where it is not a non-empty string', () => {
    expect(parseStoredDiceSet({ ...stored, contestRule: '  ' })).not.toHaveProperty('contestRule');
    expect(parseStoredDiceSet({ ...stored, contestRule: 7 })).not.toHaveProperty('contestRule');
  });

  it('goes through the dice rules and back', () => {
    const set = parseStoredDiceSet({ ...stored, contestRule: 'pack:duel' })!;
    const rules = diceRulesOfSet(set);
    expect(rules.contestRule).toBe('pack:duel');
    expect(rollingRules(rules).contestRule).toBe('pack:duel');
    expect(rollingRules({ defaultRoll: '1d20', crit: 'natural' })).not.toHaveProperty('contestRule');
  });

  it('is compared by sameRolling', () => {
    const set = parseStoredDiceSet(stored)!;
    expect(sameRolling(set, { ...set })).toBe(true);
    expect(sameRolling(set, { ...set, contestRule: 'pack:duel' })).toBe(false);
    expect(sameRolling({ ...set, contestRule: 'a' }, { ...set, contestRule: 'a' })).toBe(true);
  });
});

describe('contestRule of stored dice rules', () => {
  it('is kept by presets, trimmed, and dropped where invalid', () => {
    const [kept, blank, wrong] = parseUserPresets([
      preset({ ...base, contestRule: ' pack:duel ' }),
      preset({ ...base, contestRule: '  ' }),
      preset({ ...base, contestRule: 3 }),
    ]);
    expect(kept!.rules.dice).toEqual({ ...base, contestRule: 'pack:duel' });
    expect(blank!.rules.dice).toEqual(base);
    expect(wrong!.rules.dice).toEqual(base);
  });

  it('is compared by sameDiceRules', () => {
    expect(sameDiceRules({ ...base, contestRule: 'a' } as never, { ...base, contestRule: 'b' } as never)).toBe(false);
    expect(sameDiceRules({ ...base, contestRule: 'a' } as never, { ...base } as never)).toBe(false);
    expect(sameDiceRules({ ...base, contestRule: 'a' } as never, { ...base, contestRule: 'a' } as never)).toBe(true);
  });
});
