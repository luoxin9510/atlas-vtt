// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import { newSceneFile } from '../../src/app/services/newSceneFile';
import { getDataFilePath } from '../../src/app/utils/dataFileMigration';
import type { CollectionSettings } from '../../src/app/types/collectionSettingsTypes';

const SCENE_PATH = 'atlas-vtt/collections/Default/scenes/Fresh.atlasmap';

/** A store holding the scene file `content`, read the way an Atlas view reads it. */
async function storeLoading(content: string): Promise<ReturnType<typeof createViewAtlasStore>> {
  const { app } = createInMemoryApp({ files: { [getDataFilePath(SCENE_PATH)]: content } });
  app.vault.getFileByPath = app.vault.getAbstractFileByPath;
  app.vault.getFolderByPath = app.vault.getAbstractFileByPath;
  const store = createViewAtlasStore(app, 'scene-audios-backfill');
  store.getState().setPersistenceEnabled(false);
  store.getState().setMapPath(SCENE_PATH);
  await store.persist.rehydrate();
  return store;
}

const AUDIO = { x: 10, y: 20, innerRadius: 70, outerRadius: 210, volume: 0.5, soundId: 'fire', loop: true };

describe('a scene file without audio sources', () => {
  it('loads a new scene with an audio map, so the first audio source can be placed', async () => {
    const settings: CollectionSettings = { conditions: [] };
    const store = await storeLoading(JSON.stringify(newSceneFile(settings, null)));

    expect(store.getState().objects.audios).toEqual({});
    const id = store.getState().addAudio(AUDIO);
    expect(store.getState().objects.audios[id]).toMatchObject({ id, kind: 'audio', soundId: 'fire' });
  });

  it('keeps the audio sources a scene file holds', async () => {
    const audio = { id: 'audio_1', kind: 'audio', ...AUDIO };
    const file = { state: { schema: 'atlas-vtt', version: 4, objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, audios: { audio_1: audio } } }, version: 4 };
    const store = await storeLoading(JSON.stringify(file));

    expect(store.getState().objects.audios).toEqual({ audio_1: audio });
  });
});
