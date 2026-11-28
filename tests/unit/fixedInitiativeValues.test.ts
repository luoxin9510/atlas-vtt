import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { labelsOf, type ModifierStatblock } from '../../src/app/initiative/modifierFields';
import { readFixedInitiative } from '../../src/app/initiative/fixedInitiativeValues';
import { createInitiativeActions } from '../../src/app/stores/initiativeSlice';
import { initiativeEntryForToken } from '../../src/app/stores/initiativeEntries';
import { parseInitiativeRules } from '../../src/app/gameSystems/initiativeRules';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../src/app/types';
import type { TemplateField } from '../../src/app/statblocks/model/templateTypes';

const FIELDS = [{ key: 'attributes', label: 'Attributes', type: 'scores', slots: ['ST', 'DX', 'IQ', 'HT'] }] as unknown as TemplateField[];
const RULES = parseInitiativeRules({ mode: 'turn-order', firstSide: 'players', value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }, { field: 'attributes.IQ' }] })!;

const BLOCKS: Record<string, ModifierStatblock> = {
  'fast.md': { fields: { basic_speed: 6.25, attributes: [10, 14, 11, 10] }, labels: labelsOf(FIELDS) },
  'slow.md': { fields: { basic_speed: '5.5', attributes: [10, 9, 12, 10] }, labels: labelsOf(FIELDS) },
  'blank.md': { fields: { attributes: [10, 8, 10, 10] }, labels: labelsOf(FIELDS) },
};

const character = (id: string, statblockPath?: string): TokenEntity => ({ id, kind: 'character', name: id, imagePath: '', ...(statblockPath && { statblockPath }) }) as unknown as TokenEntity;
const read = async (path: string): Promise<ModifierStatblock | null> => BLOCKS[path] ?? null;

function entryFor(token: TokenEntity): InitiativeEntry {
  return { ...initiativeEntryForToken(token), id: token.id, order: 0, isActive: false };
}

describe('reading fixed initiative from linked statblocks', () => {
  const tokens = { f: character('f', 'fast.md'), s: character('s', 'slow.md'), b: character('b', 'blank.md'), n: character('n'), g: character('g', 'gone.md') };
  const entries = Object.values(tokens).map(entryFor);

  it('reads the value and the tie-break fields of every combatant with a statblock', async () => {
    const reads = await readFixedInitiative(entries, tokens, RULES, read);
    expect(reads.get('f')).toEqual({ value: 6.25, tieBreaks: [14, 11] });
    expect(reads.get('s')).toEqual({ value: 5.5, tieBreaks: [9, 12] });
  });

  it('reads no value from a statblock without the field, and reads 0 for a missing tie-break field', async () => {
    const reads = await readFixedInitiative(entries, tokens, RULES, read);
    expect(reads.get('b')).toEqual({ value: null, tieBreaks: [8, 10] });
  });

  it('reads nothing for a combatant without a statblock or whose statblock cannot be read', async () => {
    const reads = await readFixedInitiative(entries, tokens, RULES, read);
    expect(reads.get('n')).toEqual({ value: null, tieBreaks: [0, 0] });
    expect(reads.get('g')).toEqual({ value: null, tieBreaks: [0, 0] });
  });

  it('reads each statblock once however many combatants share it', async () => {
    const twins = { x: character('x', 'fast.md'), y: character('y', 'fast.md') };
    let calls = 0;
    await readFixedInitiative(Object.values(twins).map(entryFor), twins, RULES, async (path) => { calls++; return read(path); });
    expect(calls).toBe(1);
  });
});

describe('fixed initiative as combatants join and the GM reads all', () => {
  it('fills a joining combatant from its statblock, ignoring its own modifier and any dice', async () => {
    const tokens = { f: character('f', 'fast.md'), s: character('s', 'slow.md') };
    let state = { initiative: createDefaultInitiativeState(), initiativeTrackerOpen: false, objects: { tokens } };
    const actions = createInitiativeActions((recipe) => { state = produce(state, recipe); }, 'join', () => state, () => 0.99);
    const ids = Object.values(tokens).map((token) => actions.addToInitiative({ ...initiativeEntryForToken(token), initiativeModifier: 7, modifierByHand: true }));
    expect(state.initiative.entries.every((entry) => entry.awaitingInitiative)).toBe(true);
    actions.applyFixedInitiative(await readFixedInitiative(state.initiative.entries, tokens, RULES, read));
    expect(state.initiative.entries.map((entry) => [entry.id === ids[0] ? 'f' : 's', entry.initiative, entry.awaitingInitiative])).toEqual([['f', 6.25, undefined], ['s', 5.5, undefined]]);
  });
});
