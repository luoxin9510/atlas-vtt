import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createInitiativeActions } from '../../src/app/stores/initiativeSlice';
import { initiativeEdit } from '../../src/app/initiative/initiativeEdit';
import { byInitiative } from '../../src/app/initiative/tieBreak';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../src/app/types';

function waiting(id: string, extra: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return { id, tokenId: id, name: id, initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: '', isNPC: true, order: 0, isActive: false, ...extra };
}

/** Initiative actions over `entries`; the random stream hands out `randoms` in turn. */
function setup(entries: InitiativeEntry[], randoms: number[] = [0.5]) {
  let state = { initiative: { ...createDefaultInitiativeState(), entries }, initiativeTrackerOpen: false, objects: { tokens: {} as Record<string, TokenEntity> } };
  let drawn = 0;
  const random = (): number => randoms[Math.min(drawn++, randoms.length - 1)]!;
  const actions = createInitiativeActions((recipe) => { state = produce(state, recipe); }, 'fixed', () => state, random);
  const entry = (id: string): InitiativeEntry => state.initiative.entries.find((candidate) => candidate.id === id)!;
  return { actions, get: () => state, entry, order: (): string[] => state.initiative.entries.map((e) => e.id) };
}

const read = (value: number | null, ...tieBreaks: number[]) => ({ value, tieBreaks });

describe('fixed initiative applied to combatants', () => {
  it('sets the value as initiative without dice or modifier, and ends the wait', () => {
    const { actions, entry, order } = setup([waiting('a', { initiativeModifier: 4, modifierByHand: true }), waiting('b')]);
    actions.applyFixedInitiative(new Map([['a', read(5.25)], ['b', read(6.5)]]));
    expect(entry('a')).toMatchObject({ initiative: 5.25 });
    expect(entry('a').awaitingInitiative).toBeUndefined();
    expect(entry('a').rolledModifier).toBeUndefined();
    expect(entry('b').initiative).toBe(6.5);
    expect(order()).toEqual(['b', 'a']);
  });

  it('leaves a combatant without a value waiting', () => {
    const { actions, entry } = setup([waiting('a'), waiting('b')]);
    actions.applyFixedInitiative(new Map([['a', read(null)], ['b', read(3)]]));
    expect(entry('a')).toMatchObject({ initiative: 0, awaitingInitiative: true });
    expect(entry('b').awaitingInitiative).toBeUndefined();
  });

  it('refreshes values on a second read but keeps what the GM typed', () => {
    const { actions, entry } = setup([waiting('a'), waiting('b')]);
    actions.applyFixedInitiative(new Map([['a', read(5)], ['b', read(6)]]));
    actions.updateInitiativeEntry('a', { initiative: 9.5, fixedByHand: true });
    actions.applyFixedInitiative(new Map([['a', read(7, 12)], ['b', read(8, 11)]]));
    expect(entry('a').initiative).toBe(9.5);
    expect(entry('a').tieBreakValues).toEqual([12]);
    expect(entry('b').initiative).toBe(8);
  });

  it('keeps the old number where a refresh reads none', () => {
    const { actions, entry } = setup([waiting('a')]);
    actions.applyFixedInitiative(new Map([['a', read(5)]]));
    actions.applyFixedInitiative(new Map([['a', read(null)]]));
    expect(entry('a')).toMatchObject({ initiative: 5 });
  });

  it('lets the GM clear a typed value: the entry waits again and the next read fills it', () => {
    const { actions, entry } = setup([waiting('a')]);
    actions.applyFixedInitiative(new Map([['a', read(5)]]));
    actions.updateInitiativeEntry('a', { initiative: 9, fixedByHand: true });
    actions.updateInitiativeEntry('a', initiativeEdit('', '', true));
    expect(entry('a')).toMatchObject({ initiative: 0, awaitingInitiative: true });
    expect(entry('a').fixedByHand).toBeUndefined();
    actions.applyFixedInitiative(new Map([['a', read(5)]]));
    expect(entry('a').initiative).toBe(5);
  });

  it('draws the hidden tie-break roll once, and a read never draws it again', () => {
    const { actions, entry } = setup([waiting('a')], [0.25, 0.75]);
    actions.applyFixedInitiative(new Map([['a', read(5)]]));
    expect(entry('a').tieBreakRoll).toBe(0.25);
    actions.applyFixedInitiative(new Map([['a', read(5)]]));
    expect(entry('a').tieBreakRoll).toBe(0.25);
  });
});

describe('typing a fixed value', () => {
  it('reads decimals, and marks the number as typed by hand', () => {
    expect(initiativeEdit('5.25', '', true)).toMatchObject({ initiative: 5.25, fixedByHand: true });
    expect(initiativeEdit('-1', '', true)).toMatchObject({ initiative: -1, fixedByHand: true });
  });

  it('takes an empty number as clearing it, and reads no number from prose', () => {
    expect(initiativeEdit('', '', true)).toEqual({ initiative: 0, awaitingInitiative: true, fixedByHand: undefined });
    expect(initiativeEdit('fast', '', true)).toEqual({});
  });

  it('still reads a whole number only outside fixed mode', () => {
    expect(initiativeEdit('5.25', '')).toEqual({ initiativeModifier: 0, modifierByHand: undefined });
    expect(initiativeEdit('', '')).toEqual({ initiativeModifier: 0, modifierByHand: undefined });
  });
});

describe('ties between equal fixed values', () => {
  const tied = (id: string, tieBreakValues: number[], tieBreakRoll: number): InitiativeEntry =>
    ({ ...waiting(id), awaitingInitiative: undefined, initiative: 5, tieBreakValues, tieBreakRoll });

  it('go by the tie-break fields in order, the higher first', () => {
    const entries = [tied('a', [10, 15], 0.1), tied('b', [12, 9], 0.1), tied('c', [12, 14], 0.1)];
    expect([...entries].sort(byInitiative).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('still tied go by the hidden roll, kept the same however often they are sorted', () => {
    const entries = [tied('a', [10], 0.2), tied('b', [10], 0.9), tied('c', [10], 0.5)];
    expect([...entries].sort(byInitiative).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect([...entries].reverse().sort(byInitiative).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('are sorted by the store, and dragging still reorders them', () => {
    const { actions, order } = setup([tied('a', [10], 0.2), tied('b', [12], 0.2), tied('c', [12], 0.8)]);
    actions.applyFixedInitiative(new Map([['a', read(5, 10)], ['b', read(5, 12)], ['c', read(5, 12)]]));
    expect(order()).toEqual(['c', 'b', 'a']);
    actions.reorderInitiative(2, 0);
    expect(order()).toEqual(['a', 'c', 'b']);
  });

  it('leave combatants without tie-break fields in their order', () => {
    const plain = (id: string): InitiativeEntry => ({ ...waiting(id), awaitingInitiative: undefined, initiative: 5 });
    expect([plain('x'), plain('y'), plain('z')].sort(byInitiative).map((e) => e.id)).toEqual(['x', 'y', 'z']);
  });
});
