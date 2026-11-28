import { describe, expect, it } from 'vitest';
import { isResourceFieldOf } from '../../../src/app/importers/resourceFieldKeys';
import { meaningsOf } from '../../../src/app/statblocks/resolve/fieldMeanings';
import { ADVENTURER, RESOURCES } from '../../fixtures/recoveryFixtures';

describe('which note fields are resources', () => {
  it('are the collection\'s counting resources and the template\'s hit points, never a static value or a plain number', () => {
    const isResource = isResourceFieldOf(ADVENTURER, RESOURCES, meaningsOf(ADVENTURER.fields));
    expect(isResource('hp')).toBe(true);
    expect(isResource('stress')).toBe(true);
    expect(isResource('ac')).toBe(false);
    expect(isResource('con')).toBe(false);
    expect(isResource('level')).toBe(false);
  });

  it('count the field a template means as its hit points whatever its key', () => {
    const template = { ...ADVENTURER, fields: ADVENTURER.fields.map((field) => (field.key === 'hp' ? { ...field, key: 'vitality' } : field)) };
    expect(isResourceFieldOf(template, [], meaningsOf(template.fields))('vitality')).toBe(true);
  });

  it('without a template read the collection\'s counting resources by field', () => {
    const isResource = isResourceFieldOf(null, RESOURCES, {});
    expect(isResource('hp')).toBe(true);
    expect(isResource('ac')).toBe(false);
    expect(isResource('cr')).toBe(false);
  });
});
