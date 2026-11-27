import { describe, expect, it } from 'vitest';
import { parseSharedRoll, type SharedRoll } from '../../../../src/app/online/protocol/index.ts';

const check = { target: 14, direction: 'under', margin: 3, success: true, crit: null, rule: 'builtin:margin' } as const;
const FIRST: SharedRoll = {
  id: 'roll_1', timestamp: 1_700_000_000_000, formula: '3d6 vs 14', modifiers: 0, total: 11, crit: null,
  rolls: [{ die: 'd6', value: 4, max: 6 }], source: { type: 'toolbar' }, check, contest: { id: 'contest_1', side: 'first' },
};
const SECOND: SharedRoll = { ...FIRST, id: 'roll_2', contest: { id: 'contest_1', side: 'second', verdict: { winner: 'first', rule: 'builtin:contest-margin' } } };
const { contest: _contest, ...WITHOUT_CONTEST } = FIRST;

describe('a shared roll\'s contest', () => {
  it('is read back as it was written, with the verdict on the second side and a tie as a null winner', () => {
    expect(parseSharedRoll(JSON.parse(JSON.stringify(FIRST)))).toEqual(FIRST);
    expect(parseSharedRoll(JSON.parse(JSON.stringify(SECOND)))).toEqual(SECOND);
    const tie = { ...SECOND, contest: { id: 'c', side: 'second', verdict: { winner: null, rule: 'builtin:contest-margin' } } } as const;
    expect(parseSharedRoll(JSON.parse(JSON.stringify(tie)))).toEqual(tie);
  });

  it('is absent from a roll that is no side of a contest', () => {
    expect(parseSharedRoll(WITHOUT_CONTEST)).not.toHaveProperty('contest');
  });

  it('drops only the contest, keeping the roll and its check, where it cannot be read', () => {
    const verdict = { winner: 'first', rule: 'builtin:contest-margin' };
    const bad: unknown[] = [
      'yes', null, [], {}, { side: 'first' }, { id: '', side: 'first' }, { id: 'x'.repeat(65), side: 'first' }, { id: 7, side: 'first' },
      { id: 'c', side: 'third' }, { id: 'c', side: 'first', verdict }, // a verdict belongs on the second side only
      { id: 'c', side: 'second', verdict: { winner: 'both', rule: 'r' } }, { id: 'c', side: 'second', verdict: { winner: 'first', rule: '' } },
      { id: 'c', side: 'second', verdict: { winner: 'first', rule: 'x'.repeat(65) } }, { id: 'c', side: 'second', verdict: 'first' },
      { id: 'c', side: 'second', verdict: { winner: 'first' } },
    ];
    for (const entry of bad) expect(parseSharedRoll({ ...FIRST, contest: entry }), JSON.stringify(entry)).toEqual(WITHOUT_CONTEST);
  });

  it('drops keys it does not know, names included: players are not told who the sides are', () => {
    expect(parseSharedRoll({ ...SECOND, contest: { ...SECOND.contest, names: { first: 'Ana' }, secret: 1 } })).toEqual(SECOND);
  });
});
