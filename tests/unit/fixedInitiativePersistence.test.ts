import { describe, expect, it, vi } from 'vitest';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import type { RulesLookup } from '../../src/app/gameSystems/mapRules';
import { BUILT_IN_SYSTEM_PRESETS } from '../../src/app/gameSystems/builtInPresets';
import { parseUserPreset } from '../../src/app/gameSystems/presetValidation';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import type { TokenEntity } from '../../src/app/types';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';

vi.mock('../../src/app/resources/collectionResources', () => ({ mapResources: () => [] }));
vi.mock('../../src/app/gameSystems/mapRules', () => ({ rulesForMap: () => ({ settings: null }), mapConditions: () => [] }));

import { sharedInitiative } from '../../src/app/online/gm/initiativeInputs';
import { parseInitiative } from '../../src/app/online/protocol/initiative';

const CAIRN_GRID = BUILT_IN_SYSTEM_PRESETS.find((p) => p.name === 'Cairn')!.rules.gridDefaults;

const entry = (tokenId: string, order: number, extra: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id: tokenId, tokenId, name: tokenId, initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order, ...extra,
});

describe('fixed initiative in a saved scene', () => {
  it('keeps the typed mark, the tie-break numbers and the hidden roll through saving and loading', () => {
    const { app } = createInMemoryApp({ files: {} });
    const store = createViewAtlasStore(app, 'fixed-persistence');
    const saved = entry('a', 0, { initiative: 5.25, fixedByHand: true, tieBreakValues: [14, 11.5], tieBreakRoll: 0.375 });
    store.setState({ initiative: { ...createDefaultInitiativeState(), entries: [saved, entry('b', 1, { awaitingInitiative: true })] } });
    const options = store.persist.getOptions();
    const file: unknown = JSON.parse(JSON.stringify(options.partialize!(store.getState())));
    const loaded = options.merge!(file, store.getState());
    expect(loaded.initiative.entries[0]).toEqual(saved);
    expect(loaded.initiative.entries[1]).toMatchObject({ awaitingInitiative: true, initiative: 0 });
  });
});

describe('online players and decimal initiative', () => {
  const token = (id: string): TokenEntity => ({ id, kind: 'token', x: 0, y: 0, imagePath: '' });
  const list = sharedInitiative({
    state: {
      initiativeTrackerOpen: true,
      mapPath: 'map.atlasmap',
      initiative: { ...createDefaultInitiativeState(), entries: [entry('a', 0, { initiative: 6.25 }), entry('b', 1, { initiative: 5.5, tieBreakValues: [9], tieBreakRoll: 0.2 })] },
      objects: { tokens: { a: token('a'), b: token('b') } },
    },
    shown: true,
    showNames: false,
    rules: {} as RulesLookup,
    art: () => null,
  });

  it('are sent the numbers as they are, and read them back unchanged', () => {
    expect(list?.combatants.map((combatant) => combatant.initiative)).toEqual([6.25, 5.5]);
    expect(parseInitiative(JSON.parse(JSON.stringify(list)))?.combatants.map((combatant) => combatant.initiative)).toEqual([6.25, 5.5]);
  });

  it('are not sent the tie-break numbers or the hidden roll', () => {
    expect(JSON.stringify(list)).not.toContain('tieBreak');
  });
});

describe('a preset with fixed initiative', () => {
  it('keeps the value and tie-break fields of its initiative rules when stored and read', () => {
    const preset = parseUserPreset({
      id: 'user:fixed', name: 'Fixed',
      rules: { gridDefaults: CAIRN_GRID, conditions: [], initiative: { mode: 'turn-order', firstSide: 'players', value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }] } },
    });
    expect(preset?.rules.initiative).toMatchObject({ mode: 'turn-order', value: { field: 'basic_speed' }, tieBreak: [{ field: 'attributes.DX' }] });
  });

  it('ignores a value in another mode, so such a preset plays as it did', () => {
    const preset = parseUserPreset({
      id: 'user:sides', name: 'Sides',
      rules: { gridDefaults: CAIRN_GRID, conditions: [], initiative: { mode: 'sides', roll: '1d20', firstSide: 'players', value: { field: 'speed' } } },
    });
    expect(preset?.rules.initiative).not.toHaveProperty('value');
  });
});
