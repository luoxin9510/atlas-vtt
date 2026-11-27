// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceRollPanel } from '../../src/app/react/components/dice3d/DiceRollPanel';
import { sceneFromRolls } from '../../src/app/dice3d/diceScene';
import { throwStyle } from '../../src/app/dice3d/diceDisplay';
import { reveal } from '../../src/app/dice3d/audio/diceSounds';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

const stage = vi.hoisted(() => ({ crit: [] as unknown[] }));

// jsdom has no WebGL: the stage is a stand-in that lands its dice on mount and says which crit it was given.
vi.mock('../../src/app/react/components/dice3d/DiceStage', () => ({
  DiceStage: ({ crit, onSettled }: { crit: unknown; onSettled: () => void }): React.ReactElement => {
    stage.crit.push(crit);
    useEffect(() => { onSettled(); }, []);
    return <div className="stage" />;
  },
}));
vi.mock('../../src/app/dice3d/audio/diceSounds', () => ({ reveal: vi.fn(), ratchet: vi.fn() }));
vi.mock('../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); stage.crit = []; });

/** The dice rolled their natural maximum, the check failed critically. */
const MAXED_BUT_FAILED: DiceRollResult = {
  id: 'c', timestamp: 0, formula: '1d20 vs 5', rolls: [{ die: 'd20', value: 20, max: 20 }], modifiers: 0, total: 20, crit: 'high',
  check: { target: 5, direction: 'under', margin: -15, success: false, crit: 'failure', rule: 'margin' },
};

function panel(result: DiceRollResult, muted = false): HTMLElement {
  const { container } = render(
    <DiceRollPanel
      result={result}
      presentation={null}
      scene={sceneFromRolls(result.rolls)!}
      compact={false}
      leaving={false}
      muted={muted}
      style={throwStyle('full')}
      onClose={() => undefined}
      onDone={() => undefined}
      useAvatar={() => null}
    />,
  );
  return container;
}

describe('the 3D panel', () => {
  it('shows the check line once the dice land, with the crit of the check', () => {
    const container = panel(MAXED_BUT_FAILED);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector('.atlas-check-line')?.textContent).toBe('Critical failure by 15');
    expect(container.querySelector('.atlas-dice-roll--crit-fail')).not.toBeNull();
    expect(container.querySelector('.atlas-dice-roll--crit-success')).toBeNull();
  });

  it('gives the stage and the reveal sound the crit of the check', () => {
    panel(MAXED_BUT_FAILED);
    expect(stage.crit.every((crit) => crit === 'low')).toBe(true);
    expect(reveal).toHaveBeenCalledWith('low');
  });

  it('shows no line for a roll without a check', () => {
    const plain: DiceRollResult = { ...MAXED_BUT_FAILED, id: 'p', formula: '1d20' };
    delete plain.check;
    const container = panel(plain);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector('.atlas-check-line')).toBeNull();
    expect(container.querySelector('.atlas-dice-roll--crit-success')).not.toBeNull();
  });

  it('shows how a moved target was built under the check line', () => {
    const moved: DiceRollResult = {
      ...MAXED_BUT_FAILED, formula: '1d20 vs 7',
      check: { ...MAXED_BUT_FAILED.check!, target: 7, baseTarget: 5, targetSteps: [{ label: 'Agility', value: 2 }] },
    };
    const container = panel(moved);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector('.atlas-target-line')?.textContent).toBe('Target 5 → 7 (Agility +2)');
    const plain = panel(MAXED_BUT_FAILED);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(plain.querySelector('.atlas-target-line')).toBeNull();
  });

  it('badges a GM-only roll and no other', () => {
    expect(panel({ ...MAXED_BUT_FAILED, hidden: true }).querySelector('.atlas-gm-only-badge')?.textContent).toBe('GM only');
    expect(panel(MAXED_BUT_FAILED).querySelector('.atlas-gm-only-badge')).toBeNull();
  });
});
