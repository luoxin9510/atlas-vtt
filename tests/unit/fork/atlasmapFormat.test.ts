// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { beforeAll, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { createViewAtlasStore } from '../../../src/app/storeFactory';
import { ATLAS_VERSION, migrateMapFile, parseSceneFile } from '../../../src/app/services/MapPersistence';
import { newSceneFile } from '../../../src/app/services/newSceneFile';
import { sceneFromFile, sceneToFile } from '../../../src/app/resources/resourceFileFormat';
import { resourceUpdate } from '../../../src/app/resources/resourceValues';
import { getDataFilePath } from '../../../src/app/utils/dataFileMigration';
import type { CollectionSettings } from '../../../src/app/types/collectionSettingsTypes';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const EXAMPLE = read('docs/fork/examples/minimal.atlasmap');
const SCHEMA: unknown = JSON.parse(read('docs/fork/atlasmap.schema.json'));
const EXAMPLE_PATH = 'atlas-vtt/collections/Examples/scenes/Minimal.atlasmap';

let validate: ValidateFunction;

function errorsOf(data: unknown): string {
  return validate(data) ? '' : JSON.stringify(validate.errors, null, 2);
}

beforeAll(() => {
  // The generated schema is draft-07, which is what the default Ajv class speaks.
  validate = new Ajv({ allErrors: true }).compile(SCHEMA as object);
});

describe('the .atlasmap JSON Schema', () => {
  it('accepts the minimal example', () => {
    expect(errorsOf(JSON.parse(EXAMPLE))).toBe('');
  });

  it('rejects an envelope of another version and a token of the in-memory shape', () => {
    const newer = { ...JSON.parse(EXAMPLE), version: 5 };
    expect(validate(newer)).toBe(false);

    const inMemory = JSON.parse(EXAMPLE);
    inMemory.state.objects.tokens.tok_1.resources = { hp: { current: 7, max: 7 } };
    expect(validate(inMemory)).toBe(false);
  });
});

describe('the minimal example through Atlas\' own reading code', () => {
  it('parses, migrates and converts to the in-memory shape', () => {
    const envelope = parseSceneFile(EXAMPLE);
    expect(envelope.version).toBe(ATLAS_VERSION);

    const migrated = migrateMapFile(envelope.state);
    expect(migrated.version).toBe(ATLAS_VERSION);
    expect(migrated.background).toBe('atlas-vtt/assets/minimal-map.png');
    expect(migrated.grid).toMatchObject({ type: 'square', size: 70 });
    expect(Object.keys(migrated.objects.walls)).toEqual(['wall_1']);
    expect(Object.keys(migrated.objects.lights)).toEqual(['light_1']);

    const scene = sceneFromFile(envelope.state);
    const token = scene.objects?.tokens?.tok_1 as Record<string, unknown>;
    expect(token).toMatchObject({ id: 'tok_1', x: 245, y: 175, resources: { hp: { current: 7, max: 7 } } });
    expect(token).not.toHaveProperty('hp');
  });

  it('rehydrates a store through the real storage path', async () => {
    const { app } = createInMemoryApp({ files: { [getDataFilePath(EXAMPLE_PATH)]: EXAMPLE } });
    app.vault.getFileByPath = app.vault.getAbstractFileByPath;
    app.vault.getFolderByPath = app.vault.getAbstractFileByPath;
    const store = createViewAtlasStore(app, 'atlasmap-format-example');
    store.getState().setPersistenceEnabled(false);
    store.getState().setMapPath(EXAMPLE_PATH);
    await store.persist.rehydrate();

    const state = store.getState();
    expect(state.version).toBe(ATLAS_VERSION);
    expect(state.background).toBe('atlas-vtt/assets/minimal-map.png');
    expect(state.objects.tokens.tok_1).toMatchObject({ id: 'tok_1', x: 245, y: 175, resources: { hp: { current: 7, max: 7 } } });
    expect(state.objects.pins.pin_1).toMatchObject({ notePath: 'Notes/Cave entrance.md' });
    expect(state.objects.walls.wall_1).toMatchObject({ p2: { x: 140, y: 280 } });
    expect(state.objects.lights.light_1).toMatchObject({ x: 315, y: 210 });
  });
});

describe('files Atlas writes validate against the schema', () => {
  it('accepts a scene saved by a store, with a token resource, an initiative entry and settings', async () => {
    const { app, files } = createInMemoryApp();
    app.vault.getFileByPath = app.vault.getAbstractFileByPath;
    app.vault.getFolderByPath = app.vault.getAbstractFileByPath;
    const path = 'maps/schema-check.atlasmap';
    const store = createViewAtlasStore(app, 'atlasmap-format-written');
    store.setState({ mapPath: path, mapLoaded: true, background: 'atlas-vtt/assets/map.png' });

    const resources = { hp: { current: 9, max: 9 }, stress: { current: 0, max: 6 }, hope: { current: 2, max: 6 }, mana: { current: 4, max: 8 } };
    const id = store.getState().addToken({ kind: 'character', x: 105, y: 105, imagePath: 'mage.png', name: 'Mage', resources, overriddenMax: ['hp', 'mana'] } as never);
    const token = store.getState().objects.tokens[id]!;
    store.getState().updateToken(id, resourceUpdate(token, 'hp', { current: 0, max: 9 }, false));
    store.getState().addToInitiative({ tokenId: id, name: 'Mage', initiative: 14, initiativeModifier: 2, imagePath: 'mage.png', isNPC: false });
    store.getState().addNotePin(35, 35, 'Notes/Crypt.md#Door');
    store.getState().addWall({ type: 'door', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, closed: true });
    store.getState().addLight({ x: 70, y: 70, emission: { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: 'none' } });
    await (store as typeof store & { flushStorage: () => Promise<void> }).flushStorage();
    await waitFor(() => expect(files.has(getDataFilePath(path))).toBe(true));

    const written = JSON.parse(files.get(getDataFilePath(path))!);
    expect(written.state.objects.tokens[id]).toMatchObject({ hp: { current: 0, max: 9 }, maxStress: 6, statblockResources: { mana: expect.any(Object) } });
    expect(written.state.initiative.entries[0]).toMatchObject({ isDefeated: true });
    expect(errorsOf(written)).toBe('');
  });

  it('accepts the serialised sceneToFile output of a store state without a writer', () => {
    const store = createViewAtlasStore(createInMemoryApp().app, 'atlasmap-format-to-file');
    const id = store.getState().addToken({ kind: 'token', x: 35, y: 35, imagePath: 'rat.png', resources: { hp: { current: 1, max: 3 } } } as never);
    const { objects, tokenSettings, initiative, camera, grid, lighting } = store.getState();
    const state = sceneToFile({ schema: 'atlas-vtt', version: ATLAS_VERSION, background: null, grid, objects, camera, tokenSettings, initiative, lighting });
    expect(state.objects.tokens[id]).toMatchObject({ hp: { current: 1, max: 3 } });
    expect(errorsOf(JSON.parse(JSON.stringify({ state, version: ATLAS_VERSION })))).toBe('');
  });

  it('accepts the file of a new scene', () => {
    const settings: CollectionSettings = { conditions: [], gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'units' } };
    const file = newSceneFile(settings, 'atlas-vtt/assets/map.png');
    expect(errorsOf(JSON.parse(JSON.stringify(file, null, 2)))).toBe('');
  });
});
