import { describe, expect, it } from 'vitest';
import { findModifierField, labelsOf, type ModifierStatblock } from '../../src/app/initiative/modifierFields';
import { readFixedNumber } from '../../src/app/initiative/fixedInitiativeReading';
import type { TemplateField } from '../../src/app/statblocks/model/templateTypes';

const FIELDS = [
  { key: 'attributes', label: 'Attributes', type: 'scores', slots: ['ST', 'DX', 'IQ', 'HT'] },
  { key: 'basic_speed', label: 'Basic Speed', type: 'number' },
] as unknown as TemplateField[];

const goblin: ModifierStatblock = {
  fields: { attributes: [10, 11, 13, 10], basic_speed: 5.25, note: 'fast', speed_text: '5.5', empty: '', size: '10 ft.' },
  labels: labelsOf(FIELDS),
};

describe('a number read from a statblock field path', () => {
  it('reads a number, a decimal one, and a numeric text', () => {
    expect(readFixedNumber(goblin, 'basic_speed')).toBe(5.25);
    expect(readFixedNumber(goblin, 'Basic Speed')).toBe(5.25);
    expect(readFixedNumber(goblin, 'speed_text')).toBe(5.5);
  });

  it('reads a scores slot by its name, as `attributes.DX`, or by its index', () => {
    expect(readFixedNumber(goblin, 'attributes.DX')).toBe(11);
    expect(readFixedNumber(goblin, 'attributes.dx')).toBe(11);
    expect(readFixedNumber(goblin, 'attributes.1')).toBe(11);
    expect(readFixedNumber(goblin, 'DX')).toBe(11);
    expect(readFixedNumber(goblin, 'attributes.HT')).toBe(10);
  });

  it('resolves a slot name in a path the resolver alone does not know', () => {
    expect(findModifierField(goblin, 'attributes.IQ')?.value).toBe(13);
  });

  it('reads nothing from a missing field, a text, an empty value or a slot that is not there', () => {
    for (const field of ['missing', 'note', 'empty', 'size', 'attributes.XX', 'attributes', '', '  ']) {
      expect(readFixedNumber(goblin, field), field).toBeNull();
    }
  });
});
