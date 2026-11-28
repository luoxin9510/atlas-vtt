import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createInitiativeActions } from '../../src/app/stores/initiativeSlice';
import { formatInitiative } from '../../src/app/initiative/formatInitiative';
import { initiativeEdit, totalEdit } from '../../src/app/initiative/initiativeEdit';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../src/app/types';

function waiting(id: string, extra: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return { id, tokenId: id, name: id, initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: '', isNPC: true, order: 0, isActive: false, ...extra };
}

function setup(entries: InitiativeEntry[], randoms: number[] = [0.5]) {
  let state = { initiative: { ...createDefaultInitiativeState(), entries }, initiativeTrackerOpen: false, objects: { tokens: {} as Record<string, TokenEntity> } };
  let drawn = 0;
  const random = (): number => randoms[Math.min(drawn++, randoms.length - 1)]!;
  const actions = createInitiativeActions((recipe) => { state = produce(state, recipe); }, 'review', () => state, random);
  const entry = (id: string): InitiativeEntry => state.initiative.entries.find((candidate) => candidate.id === id)!;
  return { actions, entry, order: (): string[] => state.initiative.entries.map((e) => e.id) };
}

const read = (value: number | null, ...tieBreaks: number[]) => ({ value, tieBreaks });

describe('a dragged order among equal fixed values', () => {
  it('holds when a joiner is read afterwards', () => {
    const { actions, order } = setup([waiting('a'), waiting('b'), waiting('c')], [0.2, 0.9, 0.5]);
    actions.applyFixedInitiative(new Map([['a', read(5.25, 10)], ['b', read(5.25, 12)]]));
    expect(order()).toEqual(['b', 'a', 'c']);
    actions.reorderInitiative(1, 0);
    expect(order()).toEqual(['a', 'b', 'c']);
    actions.applyFixedInitiative(new Map([['c', read(3, 1)]]));
    expect(order()).toEqual(['a', 'b', 'c']);
    actions.updateInitiativeEntry('c', { initiative: 8, fixedByHand: true });
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('holds after moving to the back and to the front', () => {
    const { actions, order } = setup([waiting('a'), waiting('b'), waiting('c')], [0.2, 0.9, 0.5]);
    actions.applyFixedInitiative(new Map([['a', read(5, 1)], ['b', read(5, 3)], ['c', read(5, 2)]]));
    expect(order()).toEqual(['b', 'c', 'a']);
    actions.moveToBack('b');
    expect(order()).toEqual(['c', 'a', 'b']);
    actions.applyFixedInitiative(new Map([['a', read(5, 1)]]));
    expect(order()).toEqual(['c', 'a', 'b']);
    actions.moveToFront('b');
    actions.applyFixedInitiative(new Map([['a', read(5, 1)]]));
    expect(order()).toEqual(['b', 'c', 'a']);
  });
});

describe('a rolled preset after a fixed one', () => {
  it('sorts equal totals as before, ignoring leftover fixed fields', () => {
    const left = (id: string, values: number[], roll: number): InitiativeEntry => waiting(id, { awaitingInitiative: undefined, initiative: 5, tieBreakValues: values, tieBreakRoll: roll });
    const { actions, order } = setup([left('a', [1], 0.1), left('b', [9], 0.9), waiting('c', { awaitingInitiative: undefined, initiative: 2 })]);
    actions.updateInitiativeEntry('c', { initiative: 7 });
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('drops the fixed fields on a roll, so a later fixed read is not skipped', () => {
    const { actions, entry } = setup([waiting('a', { awaitingInitiative: undefined, initiative: 5, fixedByHand: true, tieBreakValues: [3], tieBreakRoll: 0.4 })]);
    actions.rollAllInitiative('1d20');
    expect(entry('a').fixedByHand).toBeUndefined();
    expect(entry('a').tieBreakValues).toBeUndefined();
    expect(entry('a').tieBreakRoll).toBeUndefined();
    actions.applyFixedInitiative(new Map([['a', read(6.5)]]));
    expect(entry('a').initiative).toBe(6.5);
  });
});

describe('a typed value before any read', () => {
  it('draws the hidden tie roll once', () => {
    const { actions, entry } = setup([waiting('a')], [0.3, 0.8]);
    actions.updateInitiativeEntry('a', { initiative: 7, fixedByHand: true });
    expect(entry('a').tieBreakRoll).toBe(0.3);
    actions.updateInitiativeEntry('a', { initiative: 8, fixedByHand: true });
    expect(entry('a').tieBreakRoll).toBe(0.3);
  });
});

describe('an edit that changes nothing', () => {
  const shown = waiting('a', { awaitingInitiative: undefined, initiative: 5.25 });
  it('is not marked as typed', () => {
    expect(totalEdit('5.25', true, shown)).toEqual({});
    expect(initiativeEdit(' 5.25 ', '', true, shown)).toEqual({});
    expect(totalEdit('', true, waiting('w'))).toEqual({});
  });
  it('still marks a different number', () => {
    expect(totalEdit('6', true, shown)).toEqual({ initiative: 6, fixedByHand: true });
  });
});

describe('typing decimals in fixed mode', () => {
  it('accepts a comma as the decimal separator', () => {
    expect(totalEdit('5,5', true)).toEqual({ initiative: 5.5, fixedByHand: true });
    expect(initiativeEdit('-2,25', '', true)).toEqual({ initiative: -2.25, fixedByHand: true });
  });
  it('changes nothing for text it cannot read', () => {
    expect(totalEdit('5,5,5', true)).toEqual({});
    expect(initiativeEdit('1,2.3', '', true)).toEqual({});
  });
});

describe('formatInitiative', () => {
  it('writes whole numbers whole and non-finite numbers as a dash', () => {
    expect(formatInitiative(12345678901234)).toBe('12345678901234');
    expect(formatInitiative(-7)).toBe('-7');
    expect(formatInitiative(NaN)).toBe('–');
    expect(formatInitiative(Infinity)).toBe('–');
    expect(formatInitiative(0.1 + 0.2)).toBe('0.3');
  });
});
