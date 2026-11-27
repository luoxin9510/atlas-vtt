// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceRollStack } from '../../src/app/react/components/dice3d/DiceRollStack';
import type { StackedRoll } from '../../src/app/react/components/dice3d/rollStackState';
import { sceneFromRolls } from '../../src/app/dice3d/diceScene';
import { throwStyle } from '../../src/app/dice3d/diceDisplay';
import { setLocale } from '../../src/app/i18n';
import { TRANSLATIONS } from '../../src/app/i18n/languages';
import type { RollContest } from '../../src/app/dice/contestTypes';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

const stage = vi.hoisted(() => ({ land: new Map<string, () => void>() }));

// jsdom has no WebGL: the stage is a stand-in whose dice land when the test says so.
vi.mock('../../src/app/react/components/dice3d/DiceStage', () => ({
  DiceStage: ({ seed, onSettled }: { seed: string; onSettled: () => void }): React.ReactElement => {
    useEffect(() => {
      stage.land.set(seed, onSettled);
      return (): void => { stage.land.delete(seed); };
    }, [seed, onSettled]);
    return <div className="stage" />;
  },
}));
vi.mock('../../src/app/dice3d/audio/diceSounds', () => ({ reveal: vi.fn(), ratchet: vi.fn() }));
vi.mock('../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); stage.land.clear(); setLocale('en', TRANSLATIONS); });

const check = (margin: number): DiceRollResult['check'] => ({ target: 12, direction: 'under', margin, success: margin >= 0, crit: null, rule: 'margin' });

function side(id: string, contest: RollContest, margin: number): StackedRoll {
  const rolls = [{ die: 'd6', value: 3, max: 6 }];
  const result: DiceRollResult = { id, timestamp: 0, formula: '1d6 vs 12', rolls, modifiers: 0, total: 3, check: check(margin), contest };
  return { result, scene: sceneFromRolls(rolls)!, style: throwStyle('full') };
}

const first = (names?: RollContest['names']): StackedRoll => side('a', { id: 'c', side: 'first', ...(names && { names }) }, 3);
const second = (names?: RollContest['names'], winner: 'first' | 'second' | null = 'first'): StackedRoll =>
  side('b', { id: 'c', side: 'second', ...(names && { names }), verdict: { winner, rule: 'builtin:contest-margin' } }, 1);

function stack(rolls: readonly StackedRoll[]): HTMLElement {
  const { container } = render(<DiceRollStack rolls={rolls} muted onClose={() => undefined} onDone={() => undefined} useAvatar={() => null} />);
  return container;
}
const land = (id: string): void => { act(() => { stage.land.get(id)?.(); }); };
const verdict = (container: HTMLElement): string | undefined => container.querySelector('.atlas-contest-verdict')?.textContent ?? undefined;

describe('a contest in the 3D roll stack', () => {
  it('shows two panels, each with its own check line once landed', () => {
    const container = stack([first(), second()]);
    expect(container.querySelectorAll('.atlas-dice-roll')).toHaveLength(2);
    land('a');
    land('b');
    expect(container.querySelectorAll('.atlas-check-line')).toHaveLength(2);
  });

  it('shows the verdict only once both panels have landed, under the second', () => {
    const container = stack([first(), second()]);
    expect(verdict(container)).toBeUndefined();
    land('b');
    expect(verdict(container)).toBeUndefined();
    land('a');
    expect(verdict(container)).toBe('First side wins');
    const panels = container.querySelectorAll('.atlas-dice-roll');
    expect(panels[1]!.nextElementSibling?.className).toContain('atlas-contest-verdict');
    expect(panels[0]!.nextElementSibling).toBe(panels[1]);
  });

  it('names the winner by the names of the contest', () => {
    const container = stack([first({ first: 'Ana', second: 'Bo' }), second({ first: 'Ana', second: 'Bo' }, 'second')]);
    land('a');
    land('b');
    expect(verdict(container)).toBe('Bo wins');
  });

  it('says Tie, and in Chinese 平局 and 第一方 胜', () => {
    const tie = stack([first(), second(undefined, null)]);
    land('a');
    land('b');
    expect(verdict(tie)).toBe('Tie');
    stage.land.clear();
    setLocale('zh', TRANSLATIONS);
    const zh = stack([first(), second()]);
    land('a');
    land('b');
    expect(verdict(zh)).toBe('第一方 胜');
  });

  it('still shows the verdict where the first panel is not shown', () => {
    const container = stack([second()]);
    expect(verdict(container)).toBeUndefined();
    land('b');
    expect(verdict(container)).toBe('First side wins');
  });

  it('still shows the verdict where the first panel is leaving', () => {
    const container = stack([{ ...first(), leaving: true }, second()]);
    land('b');
    expect(verdict(container)).toBe('First side wins');
  });

  it('shows no verdict for a roll that is no contest', () => {
    const plain = second();
    delete plain.result.contest;
    const container = stack([plain]);
    land('b');
    expect(verdict(container)).toBeUndefined();
  });
});
