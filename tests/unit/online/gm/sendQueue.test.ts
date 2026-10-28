import { describe, expect, it } from 'vitest';
import type { Timers } from '../../../../src/app/online/gm/companionTimers.ts';
import { SendQueue } from '../../../../src/app/online/gm/sendQueue.ts';

const idle: Timers = { now: () => 0, setTimer: () => 1, clearTimer: () => undefined };

describe('dropping queued frames by tag', () => {
  it('removes every frame of a tag for every player, keeps the others in order, and counts what it removed', () => {
    const queue = new SendQueue(idle);
    queue.push('a1', 'ana', undefined, 'asset:a');
    queue.push('b1', 'ana', undefined, 'asset:b');
    queue.push('plain', 'ana');
    queue.push('a2', 'ben', undefined, 'asset:a');
    queue.push('b2', 'ben', undefined, 'asset:b');
    expect(queue.dropTagged('asset:a')).toBe(2);
    expect(queue.length).toBe(3);
    expect(queue.dropTagged('asset:a')).toBe(0);
    const sent: string[] = [];
    queue.attach({ bufferedAmount: 0, send: (text) => void sent.push(text) });
    expect(sent).toEqual(['b1', 'plain', 'b2']);
  });

  it('never drops live frames', () => {
    const queue = new SendQueue(idle);
    queue.pushLive('k', 'live', 'ana');
    queue.push('a1', 'ana', undefined, 'asset:a');
    expect(queue.dropTagged('asset:a')).toBe(1);
    expect(queue.length).toBe(1);
  });
});
