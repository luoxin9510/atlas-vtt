// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InitiativeRules } from '../../src/app/types/initiativeRulesTypes';

const FIXED: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players', value: { field: 'speed' } };
const DICE: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
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
const menus = vi.hoisted(() => ({ opened: [] as { label?: string }[][] }));
vi.mock('../../src/app/react/root/ContextMenuContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openContextMenuGlobal: (entries: { label?: string }[]) => { menus.opened.push(entries); },
}));

import { InitiativeTracker } from '../../src/app/react/components/InitiativeTracker';
import { initiativeEntryForToken } from '../../src/app/stores/initiativeEntries';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { createViewAtlasStore, type ViewAtlasStore } from '../../src/app/storeFactory';
import { createInMemoryApp } from '../mocks/inMemoryVault';

function show(current: InitiativeRules, initiative = 6.25): { store: ViewAtlasStore; container: HTMLElement } {
  rules.current = current;
  const { app } = createInMemoryApp({ files: {} });
  const store = createViewAtlasStore(app, 'fixed-ui');
  store.getState().setMapPath('atlas-vtt/collections/x/scenes/Road.atlasmap');
  store.setState({ mapLoaded: true, initiativeTrackerOpen: true });
  const added = store.getState().addToken({ kind: 'character', name: 'Fast', x: 0, y: 0, imagePath: 'tokens/Fast.webp' });
  const tokenId = typeof added === 'string' ? added : Object.values(store.getState().objects.tokens)[0]!.id;
  const id = store.getState().addToInitiative(initiativeEntryForToken(store.getState().objects.tokens[tokenId]!));
  store.getState().updateInitiativeEntry(id, { initiative, awaitingInitiative: undefined, fixedByHand: true });
  const { container } = render(
    <AtlasUIContext.Provider value={{ app, view: null, pixiApp: null, renderer: null }}>
      <ViewStoreProvider store={store}><InitiativeTracker /></ViewStoreProvider>
    </AtlasUIContext.Provider>,
  );
  return { store, container };
}

afterEach(() => { cleanup(); menus.opened.length = 0; });

describe('the tracker header', () => {
  it('reads "Read from statblocks" with its own icon in fixed mode, and rolls as before otherwise', () => {
    const fixed = show(FIXED);
    const button = screen.getByRole('button', { name: 'Read from statblocks' });
    expect(button.querySelector('.lucide-file-down')).not.toBeNull();
    expect(button.querySelector('.lucide-dices')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Roll initiative' })).toBeNull();
    expect(fixed.container.querySelector('[title]')).toBeNull();
    cleanup();

    show(DICE);
    const roll = screen.getByRole('button', { name: 'Roll initiative' });
    expect(roll.querySelector('.lucide-dices')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Read from statblocks' })).toBeNull();
  });
});

describe('the card menu', () => {
  const labels = (): (string | undefined)[] => menus.opened[0]!.map((entry) => entry.label);

  it('offers no roll in fixed mode, and keeps it otherwise', () => {
    const { container } = show(FIXED);
    fireEvent.contextMenu(container.querySelector('.atlas-initiative-card')!);
    expect(labels()).not.toContain('Roll Initiative');
    expect(labels()).toContain('Edit Initiative');
    cleanup();
    menus.opened.length = 0;

    const dice = show(DICE);
    fireEvent.contextMenu(dice.container.querySelector('.atlas-initiative-card')!);
    expect(labels()).toContain('Roll Initiative');
  });
});

describe('decimals on the card', () => {
  const NOISY = 0.1 + 0.2;

  it('shows the number as written, without float noise, and opens a decimal keyboard in fixed mode', () => {
    const { container } = show(FIXED, NOISY);
    const number = container.querySelector('.atlas-initiative-card__initiative')!;
    expect(number.textContent).toBe('0.3');
    expect(number.getAttribute('aria-label')).toBe('Initiative 0.3, click to type');
    fireEvent.click(number);
    const input = container.querySelector<HTMLInputElement>('.atlas-initiative-card__initiative-input')!;
    expect(input.value).toBe('0.3');
    expect(input.inputMode).toBe('decimal');
  });

  it('keeps whole numbers whole and the numeric keyboard where nothing is fixed', () => {
    const { container } = show(DICE, 6);
    const number = container.querySelector('.atlas-initiative-card__initiative')!;
    expect(number.textContent).toBe('6');
    fireEvent.click(number);
    expect(container.querySelector<HTMLInputElement>('.atlas-initiative-card__initiative-input')!.inputMode).toBe('numeric');
  });
});
