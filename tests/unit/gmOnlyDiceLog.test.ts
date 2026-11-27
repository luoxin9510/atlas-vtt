// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import type { DiceRollResult } from '../../src/app/types/diceTypes';
import { getDataFilePath } from '../../src/app/utils/dataFileMigration';

const roll = (id: string, hidden: boolean): DiceRollResult => ({
  id, timestamp: 1, formula: '1d20', rolls: [{ die: 'd20', value: 12, max: 20 }], modifiers: 0, total: 12, ...(hidden && { hidden: true as const }),
});

describe('the scene\'s dice log', () => {
  it('keeps a GM-only roll hidden through a save and a reload, and reads an older roll as visible', async () => {
    const { app, files } = createInMemoryApp();
    app.vault.getFileByPath = app.vault.getAbstractFileByPath;
    app.vault.getFolderByPath = app.vault.getAbstractFileByPath;
    const path = 'maps/gm-only.atlasmap';
    const store = createViewAtlasStore(app, 'gm-only-save');
    store.setState({ mapPath: path, mapLoaded: true });
    store.getState().addDiceLogEntry(roll('open', false));
    store.getState().addDiceLogEntry(roll('secret', true));
    await (store as typeof store & { flushStorage: () => Promise<void> }).flushStorage();
    await waitFor(() => expect(files.has(getDataFilePath(path))).toBe(true));
    const saved = JSON.parse(files.get(getDataFilePath(path))!);
    expect(saved.state.diceLog).toHaveLength(2);

    const reopened = createViewAtlasStore(app, 'gm-only-reopen');
    reopened.getState().setPersistenceEnabled(false);
    reopened.getState().setMapPath(path);
    await reopened.persist.rehydrate();
    const byId = Object.fromEntries(reopened.getState().diceLog.map((entry) => [entry.id, entry]));
    expect(byId.secret?.hidden).toBe(true);
    expect(byId.open).not.toHaveProperty('hidden');
  });
});
