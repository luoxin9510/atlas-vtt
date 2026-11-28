import { describe, expect, it } from 'vitest';
import { keepNoteCurrent } from '../../../src/app/importers/damageKept';

const HP_ONLY = (key: string): boolean => key === 'hp';

describe('current values kept on the note', () => {
  it('keeps "12/27" at 12 when the new maximum is higher, and the string shape', () => {
    expect(keepNoteCurrent({ hp: '12/27' }, { hp: 30 }, HP_ONLY)).toEqual({ hp: '12/30' });
  });

  it('clamps the current value to the new maximum', () => {
    expect(keepNoteCurrent({ hp: '20/27' }, { hp: 15 }, HP_ONLY)).toEqual({ hp: '15/15' });
    expect(keepNoteCurrent({ hp: { current: 5, max: 27 } }, { hp: 15 }, HP_ONLY)).toEqual({ hp: { current: 5, max: 15 } });
  });

  it('leaves a note that stores only a maximum alone, and values that are no resources', () => {
    expect(keepNoteCurrent({ hp: 27, name: 'a' }, { hp: 15, name: 'b' }, HP_ONLY)).toEqual({ hp: 15, name: 'b' });
  });

  it('keeps the extra keys of the new object and the name of the old current key', () => {
    expect(keepNoteCurrent({ hp: { value: 9, max: 12 } }, { hp: { max: 20, temp: 2 } }, HP_ONLY)).toEqual({ hp: { max: 20, temp: 2, value: 9 } });
  });

  it('does not change the values it was given', () => {
    const imported = { hp: 30 };
    keepNoteCurrent({ hp: '12/27' }, imported, HP_ONLY);
    expect(imported).toEqual({ hp: 30 });
  });

  it('keeps only fields the template treats as resources: a rating of 1/2 becomes 2, never "1/2"', () => {
    expect(keepNoteCurrent({ cr: '1/2', hp: '12/27' }, { cr: 2, hp: 30 }, HP_ONLY)).toEqual({ cr: 2, hp: '12/30' });
  });

  it('leaves the shape of a non-resource map alone: an attribute with a modifier takes the file as it is', () => {
    expect(keepNoteCurrent({ dex: { value: 14, mod: 2 } }, { dex: 15 }, HP_ONLY)).toEqual({ dex: 15 });
    expect(keepNoteCurrent({ dex: { value: 14, mod: 2 } }, { dex: { value: 15, mod: 2 } }, HP_ONLY)).toEqual({ dex: { value: 15, mod: 2 } });
  });

  it('keeps a map-shaped current of a resource under the field\'s own shape', () => {
    expect(keepNoteCurrent({ hp: { value: 9, max: 12 } }, { hp: 20 }, HP_ONLY)).toEqual({ hp: { value: 9, max: 20 } });
  });
});
