import { describe, expect, it } from 'vitest';
import { isValidInitiativeRules, parseInitiativeRules, sameInitiativeRules, savedInitiativeRules } from '../../src/app/gameSystems/initiativeRules';

const fixed = { mode: 'turn-order', firstSide: 'players', value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }, { field: 'IQ' }] };

describe('fixed-value initiative rules', () => {
  it('reads a value and tie-break fields, and needs no roll', () => {
    expect(parseInitiativeRules(fixed)).toMatchObject({ mode: 'turn-order', value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }, { field: 'IQ' }] });
  });

  it('trims the fields and drops blank tie-break entries', () => {
    const rules = parseInitiativeRules({ ...fixed, value: { field: ' speed ' }, tieBreak: [{ field: ' ' }, { field: ' dx ' }, 3] });
    expect(rules?.value).toEqual({ field: 'speed' });
    expect(rules?.tieBreak).toEqual([{ field: 'dx' }]);
  });

  it('ignores a value with a blank field, and a tie-break without entries', () => {
    expect(parseInitiativeRules({ ...fixed, value: { field: '' }, tieBreak: [] })).toBeUndefined();
    const withRoll = parseInitiativeRules({ ...fixed, roll: '1d20', value: { field: '  ' }, tieBreak: [] });
    expect(withRoll).toBeDefined();
    expect(withRoll).not.toHaveProperty('value');
    expect(withRoll).not.toHaveProperty('tieBreak');
  });

  it('keeps at most four tie-break fields', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ field: `f${i}` }));
    expect(parseInitiativeRules({ ...fixed, tieBreak: many })?.tieBreak).toHaveLength(4);
  });

  it('applies to turn order only: in another mode the value is ignored', () => {
    const sides = parseInitiativeRules({ ...fixed, mode: 'sides', roll: '1d20' });
    expect(sides).toMatchObject({ mode: 'sides' });
    expect(sides).not.toHaveProperty('value');
    expect(sides).not.toHaveProperty('tieBreak');
    expect(parseInitiativeRules({ ...fixed, mode: 'cards' })).toBeUndefined();
  });

  it('still needs a valid roll without a value', () => {
    expect(parseInitiativeRules({ mode: 'turn-order', firstSide: 'players' })).toBeUndefined();
    expect(parseInitiativeRules({ mode: 'turn-order', firstSide: 'players', roll: '1d20' })).toEqual({ mode: 'turn-order', roll: '1d20', firstSide: 'players' });
  });

  it('is valid and saved with a value even without a roll', () => {
    const rules = parseInitiativeRules(fixed)!;
    expect(isValidInitiativeRules(rules)).toBe(true);
    expect(savedInitiativeRules(rules)).toMatchObject({ value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }, { field: 'IQ' }] });
  });

  it('counts the value and tie-break as part of the rules when comparing', () => {
    const a = parseInitiativeRules(fixed)!;
    expect(sameInitiativeRules(a, { ...a })).toBe(true);
    expect(sameInitiativeRules(a, { ...a, value: { field: 'other' } })).toBe(false);
    expect(sameInitiativeRules(a, { ...a, tieBreak: [{ field: 'IQ' }] })).toBe(false);
  });
});
