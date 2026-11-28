import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/index.ts';
import { OffMapRollShare } from '../../src/app/online/gm/OffMapRollShare.ts';
import type { OffMapRollFeed } from '../../src/app/services/offMapRollFeed';
import { rollForPlayers, type ShownRollToken } from '../../src/app/services/playerRollSource';
import type { DiceRollOrigin } from '../../src/app/types/diceRollOrigin';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

const origin: DiceRollOrigin = { viewId: 'view-a', mapPath: 'maps/cave.atlasmap', tokenId: 'tok' };
const wolf: ShownRollToken = { name: 'Wolf', imagePath: undefined, showRing: false, ringColor: undefined };
const view = { showNames: true, imageSrc: (): string | null => null };
const seen = { shownToken: vi.fn((_: DiceRollOrigin) => wolf) };
const unseen = { shownToken: vi.fn((_: DiceRollOrigin) => null) };

const steps = [{ label: 'Aim', value: 1 }, { label: 'Shock', value: -2 }];
const sourced: DiceRollResult['source'] = { type: 'statblock', tokenId: 'tok', tokenName: 'Wolf' };

function labelled(source?: DiceRollResult['source'], extra: Partial<DiceRollResult> = {}): DiceRollResult {
  return {
    id: 'r', timestamp: 1, formula: '1d20+1[Aim]-2[Shock] vs 12', rolls: [{ die: 'd20', value: 10, max: 20 }], modifiers: -1,
    namedModifiers: [{ label: 'Aim', value: 1 }, { label: 'Shock', value: -2 }], total: 9,
    check: { target: 12, direction: 'under', margin: 3, success: true, crit: null, rule: 'builtin:margin', baseTarget: 11, targetSteps: steps },
    ...(source ? { source } : {}), ...extra,
  };
}

describe('rollForPlayers and the labels of modifiers', () => {
  it('keeps the sum and drops the labels of an unseen token, also from the formula', () => {
    const { result } = rollForPlayers(labelled(sourced), origin, unseen, view);
    expect(result).not.toHaveProperty('namedModifiers');
    expect(result.modifiers).toBe(-1);
    expect(result.formula).toBe('1d20+1-2 vs 12');
    expect(JSON.stringify(result)).not.toMatch(/Aim|Shock/);
  });

  it('keeps every label of a token the players see', () => {
    const { result } = rollForPlayers(labelled(sourced), origin, seen, view);
    expect(result.namedModifiers).toEqual([{ label: 'Aim', value: 1 }, { label: 'Shock', value: -2 }]);
    expect(result.formula).toBe('1d20+1[Aim]-2[Shock] vs 12');
    expect(result.check?.targetSteps).toEqual(steps);
  });

  it('strips a roll with no source as it does an unseen token: there is no token the players see', () => {
    const { result } = rollForPlayers(labelled(), undefined, null, view);
    expect(JSON.stringify(result)).not.toMatch(/Aim|Shock/);
    expect(result.check?.targetSteps).toEqual([{ value: 1 }, { value: -2 }]);
    expect(result.modifiers).toBe(-1);
  });

  it('strips both sides of a contest, and never changes the roll it was given', () => {
    const side = (which: 'first' | 'second'): DiceRollResult => labelled(undefined, { contest: { id: 'c', side: which, names: { first: 'A', second: 'B' } } });
    for (const which of ['first', 'second'] as const) {
      const raw = side(which);
      const { result } = rollForPlayers(raw, undefined, null, view);
      expect(JSON.stringify(result)).not.toMatch(/Aim|Shock/);
      expect(result.contest).toEqual({ id: 'c', side: which });
      expect(raw.namedModifiers).toHaveLength(2);
    }
  });
});

describe('an off-map roll and the labels of modifiers', () => {
  it('goes to the players without modifier labels, source or not', () => {
    const bus = new EventEmitter();
    const feed: OffMapRollFeed = { onRoll: (listener) => { bus.on('roll', listener); return () => { bus.off('roll', listener); }; } };
    const sent: GmMessage[] = [];
    const share = new OffMapRollShare(() => feed, { send: (body) => sent.push(body), showGmRolls: () => true });
    share.start();
    bus.emit('roll', { result: labelled(sourced), doc: {} as Document, muted: false });
    bus.emit('roll', { result: labelled(), doc: {} as Document, muted: false });
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toMatch(/Aim|Shock/);
  });
});
