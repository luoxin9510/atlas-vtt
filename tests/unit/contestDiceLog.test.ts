// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import type { RollContest } from '../../src/app/dice/contestTypes';
import type { DiceRollResult } from '../../src/app/types/diceTypes';
import { getDataFilePath } from '../../src/app/utils/dataFileMigration';

const side = (id: string, contest: RollContest): DiceRollResult => ({
  id, timestamp: 1, formula: '1d20 vs 10', rolls: [{ die: 'd20', value: 12, max: 20 }], modifiers: 0, total: 12, contest,
  check: { target: 10, direction: 'over', margin: 2, success: true, crit: null, rule: 'margin' },
});

describe('the scene\'s dice log and contests', () => {
  it('keeps the contest of both rolls, names and verdict, through a save and a reload', async () => {
    const { app, files } = createInMemoryApp();
    app.vault.getFileByPath = app.vault.getAbstractFileByPath;
    app.vault.getFolderByPath = app.vault.getAbstractFileByPath;
    const path = 'maps/contest.atlasmap';
    const names = { first: 'Ana', second: 'Bo' };
    const store = createViewAtlasStore(app, 'contest-save');
    store.setState({ mapPath: path, mapLoaded: true });
    store.getState().addDiceLogEntry(side('a', { id: 'c', side: 'first', names }));
    store.getState().addDiceLogEntry(side('b', { id: 'c', side: 'second', names, verdict: { winner: 'first', rule: 'builtin:contest-margin' } }));
    await (store as typeof store & { flushStorage: () => Promise<void> }).flushStorage();
    await waitFor(() => expect(files.has(getDataFilePath(path))).toBe(true));

    const reopened = createViewAtlasStore(app, 'contest-reopen');
    reopened.getState().setPersistenceEnabled(false);
    reopened.getState().setMapPath(path);
    await reopened.persist.rehydrate();
    const byId = Object.fromEntries(reopened.getState().diceLog.map((entry) => [entry.id, entry]));
    expect(byId.a?.contest).toEqual({ id: 'c', side: 'first', names });
    expect(byId.b?.contest).toEqual({ id: 'c', side: 'second', names, verdict: { winner: 'first', rule: 'builtin:contest-margin' } });
  });
});
