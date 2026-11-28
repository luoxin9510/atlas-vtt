// @vitest-environment jsdom
import React, { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { createInMemoryApp, parseFrontmatter } from '../mocks/inMemoryVault';
import type { InitiativeRules } from '../../src/app/types/initiativeRulesTypes';

const FIXED: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players', value: { field: 'speed' }, tieBreak: [{ field: 'dex' }] };
const rules = vi.hoisted(() => ({ current: null as unknown as InitiativeRules }));
vi.mock('../../src/app/initiative/useMapInitiativeRules', () => ({ useMapInitiativeRules: () => rules.current }));
vi.mock('../../src/app/ui/notice', () => ({ showNotice: vi.fn() }));
vi.mock('../../src/app/resources/useMapResources', () => ({ useMapResources: () => [] }));
vi.mock('../../src/app/campaigns/usePlayedSystemCampaign', () => ({ usePlayedSystemCampaign: () => null }));
vi.mock('../../src/app/pixi/utils/tokenHighlight', () => ({ zoomToTokenWithHighlight: vi.fn() }));
vi.mock('../../src/app/react/components/StatblockHoverPreview', () => ({
  StatblockHoverPreview: () => null,
  useStatblockHoverPreview: () => [
    { hoveredEntry: null, isVisible: false, isClosing: false, position: null, anchorRect: null, notePath: null },
    { showPreview: vi.fn(), closePreview: vi.fn(), clearPreview: vi.fn() },
  ],
}));

import { InitiativeTracker } from '../../src/app/react/components/InitiativeTracker';
import { initiativeEntryForToken } from '../../src/app/stores/initiativeEntries';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { createViewAtlasStore, type ViewAtlasStore } from '../../src/app/storeFactory';

const SCENE = 'atlas-vtt/collections/gurps/scenes/Road.atlasmap';
const NOTES: Record<string, string> = {
  'statblocks/Fast.md': '---\nstatblock: true\nname: Fast\nspeed: 6.25\ndex: 14\n---\n',
  'statblocks/Slow.md': '---\nstatblock: true\nname: Slow\nspeed: 5.5\ndex: 9\n---\n',
};

function setup(): { app: App; store: ViewAtlasStore } {
  const { app, files } = createInMemoryApp({ files: NOTES });
  app.metadataCache.getFileCache = (file) => ({ frontmatter: parseFrontmatter(files.get(file.path) ?? '') });
  const store = createViewAtlasStore(app, 'fixed-initiative');
  store.getState().setMapPath(SCENE);
  store.setState({ mapLoaded: true, initiativeTrackerOpen: true });
  return { app, store };
}

function join(store: ViewAtlasStore, name: string, statblockPath: string): string {
  const token = store.getState().addToken({ kind: 'character', name, x: 0, y: 0, imagePath: `tokens/${name}.webp`, statblockPath });
  const tokenId = typeof token === 'string' ? token : Object.values(store.getState().objects.tokens).find((t) => t.kind === 'character' && t.name === name)!.id;
  return store.getState().addToInitiative(initiativeEntryForToken(store.getState().objects.tokens[tokenId]!));
}

function show(app: App, store: ViewAtlasStore): void {
  render(
    <AtlasUIContext.Provider value={{ app, view: null, pixiApp: null, renderer: null }}>
      <ViewStoreProvider store={store}><InitiativeTracker /></ViewStoreProvider>
    </AtlasUIContext.Provider>,
  );
}

const entryOf = (store: ViewAtlasStore, id: string) => store.getState().initiative.entries.find((entry) => entry.id === id)!;

afterEach(() => { vi.restoreAllMocks(); });

describe('the tracker with fixed-value initiative', () => {
  it('fills a joining combatant from its statblock without rolling, and again on roll all, keeping a typed number', async () => {
    rules.current = FIXED;
    const { app, store } = setup();
    show(app, store);
    let fast = '', slow = '';
    act(() => { fast = join(store, 'Fast', 'statblocks/Fast.md'); slow = join(store, 'Slow', 'statblocks/Slow.md'); });
    await waitFor(() => expect(entryOf(store, fast).initiative).toBe(6.25));
    expect(entryOf(store, slow)).toMatchObject({ initiative: 5.5, tieBreakValues: [9] });
    expect(entryOf(store, fast).awaitingInitiative).toBeUndefined();
    // The hidden tie-break roll is the one draw, kept
    const drawn = entryOf(store, fast).tieBreakRoll;
    expect(drawn).toBeGreaterThanOrEqual(0);
    expect(drawn).toBeLessThan(1);

    act(() => { store.getState().updateInitiativeEntry(slow, { initiative: 7, fixedByHand: true }); });
    fireEvent.click(screen.getByRole('button', { name: 'Read from statblocks' }));
    await waitFor(() => expect(entryOf(store, fast).tieBreakValues).toEqual([14]));
    expect(entryOf(store, slow).initiative).toBe(7);
    expect(entryOf(store, fast).tieBreakRoll).toBe(drawn);

    // Clearing the typed number reads the statblock's again
    act(() => { store.getState().updateInitiativeEntry(slow, { initiative: 0, awaitingInitiative: true, fixedByHand: undefined }); });
    await waitFor(() => expect(entryOf(store, slow).initiative).toBe(5.5));
  });

  it('rolls dice as before where the rules hold no value', async () => {
    rules.current = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
    const { app, store } = setup();
    show(app, store);
    let fast = '';
    act(() => { fast = join(store, 'Fast', 'statblocks/Fast.md'); });
    await act(async () => { await Promise.resolve(); });
    expect(entryOf(store, fast)).toMatchObject({ initiative: 0, awaitingInitiative: true });
    expect(entryOf(store, fast).tieBreakRoll).toBeUndefined();
  });
});
