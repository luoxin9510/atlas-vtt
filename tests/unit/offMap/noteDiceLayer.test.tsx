// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollSubscription } from '../../../src/app/react/components/dice/DiceRollDisplay';

/** What each mounted display was given and has been shown. */
const displays = vi.hoisted(() => ({ props: [] as Array<{ container: HTMLElement; dismissOnEscape?: boolean; cardSounds?: boolean }>, shown: [] as Array<{ container: HTMLElement; formula: string }> }));
vi.mock('../../../src/app/react/components/dice/DiceRollDisplay', () => ({
  DiceRollDisplay: (props: { container: HTMLElement; subscribe: DiceRollSubscription; dismissOnEscape?: boolean; cardSounds?: boolean }): null => {
    displays.props.push({ container: props.container, dismissOnEscape: props.dismissOnEscape, cardSounds: props.cardSounds });
    useEffect(() => props.subscribe((result) => displays.shown.push({ container: props.container, formula: result.formula })), [props.subscribe, props.container]);
    return null;
  },
}));
vi.mock('../../../src/app/services/diceSets/collectionDiceSets', async () => {
  const { defaultDiceSet } = await import('../../../src/app/gameSystems/diceSetResolution');
  return { diceSetOfCollection: (): unknown => defaultDiceSet() };
});

import { NoteDiceLayers } from '../../../src/app/services/NoteDiceLayers';
import { OffMapRoller } from '../../../src/app/services/offMapRoller';

const popout = (): Document => document.implementation.createHTMLDocument('popout');
const layerOf = (doc: Document): HTMLElement | null => doc.body.querySelector('.atlas-note-dice-layer');

let roller: OffMapRoller;
let layers: NoteDiceLayers;

beforeEach(() => {
  const app = {} as never;
  roller = OffMapRoller.forApp(app);
  layers = new NoteDiceLayers(app, roller);
  layers.start();
  displays.props.length = 0;
  displays.shown.length = 0;
});
afterEach(() => { layers.dispose(); document.body.empty(); });

describe('the workspace dice layer', () => {
  it('has no host until a roll is made', () => {
    expect(layerOf(document)).toBeNull();
  });

  it('mounts one host per document on its first roll, as a plugin-styled layer, and shows that roll', async () => {
    await act(async () => { roller.roll('1d20', { doc: document }); });
    const host = layerOf(document);
    expect(host).not.toBeNull();
    expect(host!.classList.contains('atlas-vtt-plugin')).toBe(true);
    expect(displays.shown).toEqual([{ container: host, formula: '1d20' }]);
    expect(displays.props[0]).toMatchObject({ container: host, dismissOnEscape: true, cardSounds: true });
  });

  it('keeps one host for every later roll of the document', async () => {
    await act(async () => { roller.roll('1d20', { doc: document }); });
    await act(async () => { roller.roll('1d6', { doc: document }); });
    expect(document.body.querySelectorAll('.atlas-note-dice-layer')).toHaveLength(1);
    expect(displays.shown.map((shown) => shown.formula)).toEqual(['1d20', '1d6']);
  });

  it('shows a window only its own rolls', async () => {
    const other = popout();
    await act(async () => { roller.roll('1d20', { doc: document }); });
    await act(async () => { roller.roll('1d4', { doc: other }); });
    const mine = layerOf(document);
    const theirs = layerOf(other);
    expect(theirs).not.toBeNull();
    expect(theirs).not.toBe(mine);
    expect(displays.shown).toEqual([{ container: mine, formula: '1d20' }, { container: theirs, formula: '1d4' }]);
  });

  it('removes the host of a window that closes, and makes a fresh one if it rolls again', async () => {
    await act(async () => { roller.roll('1d20', { doc: document }); });
    const first = layerOf(document);
    act(() => layers.removeDocument(document));
    expect(layerOf(document)).toBeNull();
    await act(async () => { roller.roll('1d8', { doc: document }); });
    expect(layerOf(document)).not.toBe(first);
  });

  it('removes every host when the plugin unloads', async () => {
    const other = popout();
    await act(async () => { roller.roll('1d20', { doc: document }); });
    await act(async () => { roller.roll('1d4', { doc: other }); });
    act(() => layers.dispose());
    expect(layerOf(document)).toBeNull();
    expect(layerOf(other)).toBeNull();
  });
});
