// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiceRollDisplay, type DiceRollSubscription } from '../../../src/app/react/components/dice/DiceRollDisplay';
import type { DiceRollResult } from '../../../src/app/types/diceTypes';

vi.mock('../../../src/app/audio/diceRevealSound', () => ({ playDiceReveal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

const roll: DiceRollResult = { id: 'a', timestamp: 0, formula: '1d20', rolls: [], modifiers: 0, total: 7 };

/** A display in a host element, with a card on screen (no WebGL here). */
function shownCard(dismissOnEscape: boolean): HTMLElement {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const host = document.body.createDiv();
  let push: (() => void) | undefined;
  const subscribe: DiceRollSubscription = (onRoll) => {
    push = () => onRoll(roll, { muted: true });
    return () => undefined;
  };
  render(<DiceRollDisplay container={host} subscribe={subscribe} dismissOnEscape={dismissOnEscape} />);
  act(() => push?.());
  return host;
}

const exiting = (host: HTMLElement): boolean => host.querySelector('[class*="exiting"]') !== null;

afterEach(() => { vi.restoreAllMocks(); document.body.empty(); });

describe('Escape on a display drawn into a host (the workspace dice layer)', () => {
  it('dismisses the rolls on screen when the display asks for it', () => {
    const host = shownCard(true);
    expect(host.querySelector('.atlas-dice-toast, [class*="toast"]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(exiting(host)).toBe(true);
  });

  it('leaves Escape alone otherwise (a pane\'s display)', () => {
    const host = shownCard(false);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(exiting(host)).toBe(false);
  });
});
