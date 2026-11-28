import { describe, expect, it } from 'vitest';
import { keepNoteCurrent } from '../../../src/app/importers/damageKept';

describe('current values kept on the note', () => {
  it('keeps "12/27" at 12 when the new maximum is higher, and the string shape', () => {
    expect(keepNoteCurrent({ hp: '12/27' }, { hp: 30 })).toEqual({ hp: '12/30' });
  });

  it('clamps the current value to the new maximum', () => {
    expect(keepNoteCurrent({ hp: '20/27' }, { hp: 15 })).toEqual({ hp: '15/15' });
    expect(keepNoteCurrent({ hp: { current: 5, max: 27 } }, { hp: 15 })).toEqual({ hp: { current: 5, max: 15 } });
  });

  it('leaves a note that stores only a maximum alone, and values that are no resources', () => {
    expect(keepNoteCurrent({ hp: 27, name: 'a' }, { hp: 15, name: 'b' })).toEqual({ hp: 15, name: 'b' });
  });

  it('keeps the extra keys of the new object and the name of the old current key', () => {
    expect(keepNoteCurrent({ hp: { value: 9, max: 12 } }, { hp: { max: 20, temp: 2 } })).toEqual({ hp: { max: 20, temp: 2, value: 9 } });
  });

  it('does not change the values it was given', () => {
    const imported = { hp: 30 };
    keepNoteCurrent({ hp: '12/27' }, imported);
    expect(imported).toEqual({ hp: 30 });
  });
});
