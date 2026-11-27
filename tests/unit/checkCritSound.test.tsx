// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiceToastObserver } from '../../src/app/services/DiceToastObserver';
import { DiceRollDisplay } from '../../src/app/react/components/dice/DiceRollDisplay';
import { playDiceReveal } from '../../src/app/audio/diceRevealSound';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

vi.mock('../../src/app/audio/diceRevealSound', () => ({ playDiceReveal: vi.fn(() => Promise.resolve()) }));
vi.mock('../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

afterEach(() => vi.clearAllMocks());

/** Natural maximum on the dice, but the check failed critically; or the other way round. */
const MAXED_BUT_FAILED: DiceRollResult = {
  id: 'a', timestamp: 0, formula: '3d6 vs 12', rolls: [], modifiers: 0, total: 18, crit: 'high',
  check: { target: 12, direction: 'under', margin: -6, success: false, crit: 'failure', rule: 'margin' },
};
const LOW_BUT_SUCCEEDED: DiceRollResult = {
  id: 'b', timestamp: 0, formula: '1d20 vs 12', rolls: [], modifiers: 0, total: 1, crit: 'low',
  check: { target: 12, direction: 'under', margin: 11, success: true, crit: 'success', rule: 'margin' },
};

describe('the result sound follows the check', () => {
  it('plays the crit of the check for a result card', () => {
    const bus = new EventEmitter();
    const sound = { playDiceResult: vi.fn() };
    const observer = new DiceToastObserver(sound, { getDiceDisplay: () => 'card' }, bus);
    bus.emit('dice-rolled', MAXED_BUT_FAILED);
    bus.emit('dice-rolled', LOW_BUT_SUCCEEDED);
    expect(sound.playDiceResult.mock.calls).toEqual([['low'], ['high']]);
    observer.destroy();
  });

  it('plays the crit of the check when a display makes the card sound itself', () => {
    const bus = new EventEmitter();
    const subscribe = (show: (result: DiceRollResult, options: { muted?: boolean }) => void): (() => void) => {
      const listener = (result: DiceRollResult): void => show(result, {});
      bus.on('dice-rolled', listener);
      return () => bus.off('dice-rolled', listener);
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<DiceRollDisplay subscribe={subscribe} cardSounds />);
    act(() => { bus.emit('dice-rolled', MAXED_BUT_FAILED); });
    expect(playDiceReveal).toHaveBeenCalledWith('low', expect.any(Number));
  });
});
