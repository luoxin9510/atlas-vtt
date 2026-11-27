import { describe, expect, it } from 'vitest';
import { parseContest } from '../../../src/app/dice/parseContest';

describe('parseContest', () => {
  it.each([
    ['12 对 14', '12', '14'],
    ['12对14', '12', '14'],
    ['12 against 14', '12', '14'],
    ['12 AGAINST 14', '12', '14'],
    ['  12   Against   14  ', '12', '14'],
    ['3d6 vs 12 对 3d6 vs 14', '3d6 vs 12', '3d6 vs 14'],
    ['1d20+5 ≥ 15 against 12', '1d20+5 ≥ 15', '12'],
    ['+5 vs 15 对 +3 vs 12', '+5 vs 15', '+3 vs 12'],
  ])('reads %j as two sides', (text, first, second) => {
    expect(parseContest(text, {})).toEqual({ first, second });
  });

  it.each([
    ['12 vs 14'],
    ['12 对 14 对 16'],
    ['12 against 14 against 16'],
    ['12 对 14 against 16'],
    ['abc 对 14'],
    ['12 对 abc'],
    ['12 对'],
    ['对 14'],
    ['12against14'],
    ['-3 对 14'],
    ['1d20 对 14'],
    ['3d6 vs 12 对 3d6'],
    [''],
  ])('does not read %j as a contest', (text) => {
    expect(parseContest(text, {})).toBeNull();
  });

  it('reads dice written without faces by the options', () => {
    expect(parseContest('2d vs 7 对 2d vs 9', { defaultFaces: 6 })).toEqual({ first: '2d vs 7', second: '2d vs 9' });
    expect(parseContest('2d vs 7 对 2d vs 9', {})).toBeNull();
  });
});
