import { describe, expect, it } from 'vitest';
import { HostKeyLock, NewcomerLimit, TableRateLimit } from '../../../apps/relay/src/limits.ts';

const MINUTE = 60_000;

describe('limits forget old addresses', () => {
  it('HostKeyLock drops expired locks and stale wrong counts', () => {
    const lock = new HostKeyLock();
    for (let i = 0; i < 5; i += 1) lock.failed('locked', 0);
    lock.failed('once', 0);
    expect(lock.tracked).toBe(2);
    expect(lock.isLocked('locked', 5 * MINUTE)).toBe(true);
    expect(lock.isLocked('other', 11 * MINUTE)).toBe(false);
    expect(lock.tracked).toBe(0);
  });

  it('HostKeyLock counts wrong keys that are more than ten minutes apart separately', () => {
    const lock = new HostKeyLock();
    for (let i = 0; i < 4; i += 1) lock.failed('a', 0);
    lock.failed('a', 11 * MINUTE);
    expect(lock.isLocked('a', 11 * MINUTE)).toBe(false);
  });

  it('TableRateLimit drops addresses whose minute is over', () => {
    const rate = new TableRateLimit();
    rate.allow('a', 0);
    rate.allow('b', 0);
    expect(rate.tracked).toBe(2);
    rate.allow('c', 2 * MINUTE);
    expect(rate.tracked).toBe(1);
  });

  it('NewcomerLimit drops addresses whose ten minutes are over', () => {
    const limit = new NewcomerLimit();
    limit.allow('a', 0);
    limit.allow('b', 0);
    expect(limit.tracked).toBe(2);
    limit.allow('c', 11 * MINUTE);
    expect(limit.tracked).toBe(1);
  });
});
