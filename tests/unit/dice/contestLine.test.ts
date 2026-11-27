import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../src/app/i18n';
import { TRANSLATIONS } from '../../../src/app/i18n/languages';
import { contestLine, contestSideName } from '../../../src/app/dice/contestLine';
import type { RollContest } from '../../../src/app/dice/contestTypes';

afterEach(() => setLocale('en', TRANSLATIONS));

const second = (over: Partial<RollContest> = {}): RollContest => ({ id: 'c', side: 'second', verdict: { winner: 'first', rule: 'builtin:contest-margin' }, ...over });

describe('contestLine', () => {
  it('names the winner by the names the contest carries', () => {
    expect(contestLine(second({ names: { first: 'Ana', second: 'Bo' } }))).toBe('Ana wins');
    expect(contestLine(second({ names: { first: 'Ana', second: 'Bo' }, verdict: { winner: 'second', rule: 'r' } }))).toBe('Bo wins');
  });

  it('falls back to First side / Second side, for a side that has no name too', () => {
    expect(contestLine(second())).toBe('First side wins');
    expect(contestLine(second({ verdict: { winner: 'second', rule: 'r' }, names: { first: 'Ana' } }))).toBe('Second side wins');
  });

  it('says Tie for a tie, and nothing where there is no verdict', () => {
    expect(contestLine(second({ verdict: { winner: null, rule: 'r' } }))).toBe('Tie');
    expect(contestLine({ id: 'c', side: 'first' })).toBeNull();
  });

  it('speaks Chinese: 第一方 / 第二方, {name} 胜, 平局', () => {
    setLocale('zh', TRANSLATIONS);
    expect(contestSideName(second(), 'first')).toBe('第一方');
    expect(contestSideName(second(), 'second')).toBe('第二方');
    expect(contestLine(second())).toBe('第一方 胜');
    expect(contestLine(second({ names: { first: '阿娜' } }))).toBe('阿娜 胜');
    expect(contestLine(second({ verdict: { winner: null, rule: 'r' } }))).toBe('平局');
  });
});
