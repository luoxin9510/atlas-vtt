import { describe, expect, it } from 'vitest';
import { FailedReads } from '../../../../../src/app/online/gm/notes/failedReads.ts';
import { clock } from './notesHarness.ts';

describe('FailedReads', () => {
  it('skips a path while its stamp holds, and not for another stamp', () => {
    const failed = new FailedReads(clock(), () => undefined);
    failed.mark('a.md', 's1', false);
    expect(failed.skip('a.md', 's1')).toBe(true);
    expect(failed.skip('a.md', 's2')).toBe(false);
    expect(failed.skip('b.md', 's1')).toBe(false);
  });

  it('schedules nothing for a mark that is not transient', () => {
    const time = clock();
    const failed = new FailedReads(time, () => undefined);
    failed.mark('a.md', 's1', false);
    expect(time.pending).toBe(0);
  });

  it('retries after each delay, clears the marker, and gives up after the last', () => {
    const time = clock();
    const retried: string[] = [];
    const failed = new FailedReads(time, (path) => void retried.push(path), [10, 20]);
    failed.mark('a.md', 's1', true);
    time.advance(10);
    expect(retried).toEqual(['a.md']);
    expect(failed.skip('a.md', 's1')).toBe(false);
    failed.mark('a.md', 's1', true);
    time.advance(20);
    expect(retried).toEqual(['a.md', 'a.md']);
    failed.mark('a.md', 's1', true);
    expect(time.pending).toBe(0);
    expect(failed.skip('a.md', 's1')).toBe(true);
  });

  it('starts the attempts again when a new stamp is marked', () => {
    const time = clock();
    const failed = new FailedReads(time, () => undefined, [10]);
    failed.mark('a.md', 's1', true);
    time.advance(10);
    failed.mark('a.md', 's1', true);
    expect(time.pending).toBe(0);
    failed.mark('a.md', 's2', true);
    expect(time.pending).toBe(1);
  });

  it('cancels the timer on clear and on clearAll', () => {
    const time = clock();
    const failed = new FailedReads(time, () => undefined);
    failed.mark('a.md', 's1', true);
    failed.mark('b.md', 's1', true);
    failed.clear('a.md');
    expect(time.pending).toBe(1);
    expect(failed.skip('a.md', 's1')).toBe(false);
    failed.clearAll();
    expect(time.pending).toBe(0);
    expect(failed.skip('b.md', 's1')).toBe(false);
  });

  it('forgets the attempts too, once a timer has fired', () => {
    for (const forget of [(failed: FailedReads): void => failed.clear('a.md'), (failed: FailedReads): void => failed.retain(new Set()), (failed: FailedReads): void => failed.clearAll()]) {
      const time = clock();
      const failed = new FailedReads(time, () => undefined, [10]);
      failed.mark('a.md', 's1', true);
      time.advance(10);
      forget(failed);
      failed.mark('a.md', 's1', true);
      expect(time.pending).toBe(1);
    }
  });
});
