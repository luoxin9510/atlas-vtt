import { describe, expect, it } from 'vitest';
import type { GmMessage } from '../../../src/app/online/protocol/index.ts';
import { messageParts } from '../../../src/app/online/gm/assetServe.ts';
import { PartAssembler } from '../../../apps/play/src/net/PartAssembler.ts';

type Piece = Extract<GmMessage, { t: 'part' }>;

/** A body of about `kib` KiB of JSON text, with non-ASCII text so a cut may fall inside a character. */
const bodyOf = (kib: number): { t: string; text: string } => ({ t: 'big', text: '魔法'.repeat(Math.ceil((kib * 1024) / 6)) });

function partsOf(body: { t: string; text: string }, id: string): Piece[] {
  const parts = messageParts(body as unknown as GmMessage, () => id);
  return parts.filter((part): part is Piece => part.t === 'part');
}

function assembler(): { feed: PartAssembler; clock: { now: number } } {
  const clock = { now: 1000 };
  return { feed: new PartAssembler(() => clock.now), clock };
}

describe('PartAssembler', () => {
  it('returns a 500 KiB body once, whatever the order its parts arrive in', () => {
    const body = bodyOf(500);
    const parts = partsOf(body, 'big1');
    expect(parts.length).toBeGreaterThan(2);
    const { feed } = assembler();
    const results = [...parts].reverse().map((part) => feed.take(part));
    expect(results.slice(0, -1).every((result) => result === null)).toBe(true);
    expect(results.at(-1)).toEqual(body);
  });

  it('completes two interleaved sets of different ids', () => {
    const one = bodyOf(400);
    const two = { ...bodyOf(450), t: 'other' };
    const a = partsOf(one, 'aaa');
    const b = partsOf(two, 'bbb');
    const { feed } = assembler();
    const done: unknown[] = [];
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      for (const part of [a[index], b[index]]) if (part !== undefined) done.push(feed.take(part));
    }
    expect(done.filter((result) => result !== null)).toEqual([one, two]);
  });

  it('drops an incomplete set after 30 s', () => {
    const body = bodyOf(500);
    const parts = partsOf(body, 'late');
    const { feed, clock } = assembler();
    expect(feed.take(parts[0] as Piece)).toBeNull();
    clock.now += 30_001;
    // The rest alone cannot complete the set the first piece started.
    expect(parts.slice(1).map((part) => feed.take(part)).every((result) => result === null)).toBe(true);
  });

  it('keeps a set that is still under 30 s old', () => {
    const body = bodyOf(500);
    const parts = partsOf(body, 'soon');
    const { feed, clock } = assembler();
    feed.take(parts[0] as Piece);
    clock.now += 29_000;
    expect(parts.slice(1).map((part) => feed.take(part)).at(-1)).toEqual(body);
  });

  it('replaces a set with the same id and another count', () => {
    const { feed } = assembler();
    const old = partsOf(bodyOf(500), 'same');
    feed.take(old[0] as Piece);
    const body = bodyOf(300);
    const fresh = partsOf(body, 'same');
    expect(fresh.length).not.toBe(old.length);
    const results = fresh.map((part) => feed.take(part));
    expect(results.at(-1)).toEqual(body);
  });

  it('holds at most 8 sets and drops the oldest', () => {
    const { feed } = assembler();
    const sets = Array.from({ length: 9 }, (_, index) => partsOf(bodyOf(300), `set${index}`));
    for (const set of sets) feed.take(set[0] as Piece);
    // The first set lost its first piece; the last still has all of its own.
    expect(sets[0]?.slice(1).map((part) => feed.take(part)).every((result) => result === null)).toBe(true);
    expect(sets[8]?.slice(1).map((part) => feed.take(part)).at(-1)).not.toBeNull();
  });

  it('answers null for data that is not JSON text', () => {
    const { feed } = assembler();
    expect(feed.take({ id: 'junk', index: 0, count: 1, data: btoa('not json') })).toBeNull();
  });
});
