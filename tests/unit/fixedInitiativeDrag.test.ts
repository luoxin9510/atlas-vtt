import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createInitiativeActions } from '../../src/app/stores/initiativeSlice';
import { totalEdit } from '../../src/app/initiative/initiativeEdit';
import { byInitiative } from '../../src/app/initiative/tieBreak';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../src/app/types';

function waiting(id: string, extra: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return { id, tokenId: id, name: id, initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: '', isNPC: true, order: 0, isActive: false, ...extra };
}

function setup(entries: InitiativeEntry[], randoms: number[] = [0.5]) {
  let state = { initiative: { ...createDefaultInitiativeState(), entries }, initiativeTrackerOpen: false, objects: { tokens: {} as Record<string, TokenEntity> } };
  let drawn = 0;
  const random = (): number => randoms[Math.min(drawn++, randoms.length - 1)]!;
  const actions = createInitiativeActions((recipe) => { state = produce(state, recipe); }, 'drag', () => state, random);
  const entry = (id: string): InitiativeEntry => state.initiative.entries.find((candidate) => candidate.id === id)!;
  return { actions, entry, order: (): string[] => state.initiative.entries.map((e) => e.id) };
}

const read = (value: number | null, ...tieBreaks: number[]) => ({ value, tieBreaks });

describe('a drag across different tie-break values', () => {
  it('survives read-all, and ends when the value read changes', () => {
    const { actions, entry, order } = setup([waiting('a'), waiting('b')], [0.2, 0.9]);
    const reads = (a: number): Map<string, ReturnType<typeof read>> => new Map([['a', read(a, 10)], ['b', read(5, 12)]]);
    actions.applyFixedInitiative(reads(5));
    expect(order()).toEqual(['b', 'a']);
    actions.reorderInitiative(1, 0);
    expect(order()).toEqual(['a', 'b']);
    expect(entry('a').orderByHand).toBe(true);
    actions.applyFixedInitiative(reads(5));
    expect(order()).toEqual(['a', 'b']);
    // Its value changed: the drag no longer applies and the fields are read again
    actions.applyFixedInitiative(reads(6));
    expect(entry('a').orderByHand).toBeUndefined();
    expect(entry('a').tieBreakValues).toEqual([10]);
    actions.applyFixedInitiative(reads(5));
    expect(order()).toEqual(['b', 'a']);
  });

  it('is dropped by a roll', () => {
    const { actions, entry } = setup([waiting('a'), waiting('b')], [0.2, 0.9]);
    actions.applyFixedInitiative(new Map([['a', read(5, 10)], ['b', read(5, 12)]]));
    actions.reorderInitiative(1, 0);
    actions.rollAllInitiative('1d20');
    expect(entry('a').orderByHand).toBeUndefined();
  });
});

describe('fixed mode ignores old modifiers', () => {
  const fixedEntry = (id: string, extra: Partial<InitiativeEntry>): InitiativeEntry => waiting(id, { awaitingInitiative: undefined, initiative: 5, ...extra });

  it('orders by the fixed fields, not leftover modifiers', () => {
    const a = fixedEntry('a', { rolledModifier: 5, initiativeModifier: 3, modifierByHand: true, tieBreakValues: [1], tieBreakRoll: 0.1 });
    const b = fixedEntry('b', { tieBreakValues: [9], tieBreakRoll: 0.9 });
    expect([a, b].sort((x, y) => byInitiative(x, y, true)).map((e) => e.id)).toEqual(['b', 'a']);
    expect([b, a].sort((x, y) => byInitiative(x, y, false)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('still honours an Act Now place', () => {
    const a = fixedEntry('a', { tieBreakValues: [1], tieBreakRoll: 0.1 });
    const b = fixedEntry('b', { tieBreak: 2, tieBreakValues: [9], tieBreakRoll: 0.9 });
    expect([a, b].sort((x, y) => byInitiative(x, y, true)).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('a typed total with a comma', () => {
  it('equal to the shown number changes nothing', () => {
    const entry = waiting('a', { awaitingInitiative: undefined, initiative: 5.5, fixedByHand: true });
    expect(totalEdit('5,5', true, entry)).toEqual({});
  });
});
