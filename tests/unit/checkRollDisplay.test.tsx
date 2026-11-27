// @vitest-environment jsdom
import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DiceToast } from '../../src/app/react/components/dice/DiceToast';
import { DiceRollEntry } from '../../src/app/react/components/dice-log/DiceRollEntry';
import type { DiceRollResult } from '../../src/app/types/diceTypes';

vi.mock('../../src/app/react/components/dice/useDiceAvatar', () => ({ useDiceAvatar: () => null }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({ useAtlasUI: () => ({ app: null, view: null }) }));

const PLAIN: DiceRollResult = {
  id: 'p', timestamp: 0, formula: '1d20', rolls: [{ die: 'd20', value: 9, max: 20 }], modifiers: 0, total: 9,
};
/** The dice rolled their natural maximum, the check failed critically. */
const MAXED_BUT_FAILED: DiceRollResult = {
  id: 'c', timestamp: 0, formula: '3d6 vs 12', rolls: [{ die: 'd6', value: 6, max: 6 }], modifiers: 0, total: 18, crit: 'high',
  check: { target: 12, direction: 'under', margin: -6, success: false, crit: 'failure', rule: 'margin' },
};
const SUCCEEDED: DiceRollResult = {
  id: 's', timestamp: 0, formula: '3d6 vs 12', rolls: [{ die: 'd6', value: 3, max: 6 }], modifiers: 0, total: 9,
  check: { target: 12, direction: 'under', margin: 3, success: true, crit: null, rule: 'margin' },
};

function toast(result: DiceRollResult): HTMLElement {
  const { container } = render(<DiceToast result={result} presentation={null} phase="visible" onDismiss={() => undefined} useAvatar={() => null} />);
  return container;
}

function entry(result: DiceRollResult): HTMLElement {
  const { container } = render(<DiceRollEntry result={result} onRepeat={() => undefined} />);
  return container;
}

describe('the card toast', () => {
  it('shows the check line under the total and takes its crit from the check', () => {
    const card = toast(MAXED_BUT_FAILED);
    expect(card.querySelector('.atlas-check-line')?.textContent).toBe('Critical failure by 6');
    expect(card.querySelector('.atlas-dice-toast--crit-fail')).not.toBeNull();
    expect(card.querySelector('.atlas-dice-toast--crit-success')).toBeNull();
  });

  it('shows no line for a roll without a check', () => {
    expect(toast(PLAIN).querySelector('.atlas-check-line')).toBeNull();
  });
});

describe('the roll log entry', () => {
  it('shows the check line and takes its crit from the check', () => {
    const row = entry(MAXED_BUT_FAILED);
    expect(row.querySelector('.atlas-check-line')?.textContent).toBe('Critical failure by 6');
    expect(row.querySelector('.dice-log-entry--crit-fail')).not.toBeNull();
    expect(row.querySelector('.dice-log-entry--crit-success')).toBeNull();
  });

  it('shows a plain success without crit styling', () => {
    const row = entry(SUCCEEDED);
    expect(row.querySelector('.atlas-check-line')?.textContent).toBe('Success by 3');
    expect(row.querySelector('[class*="--crit-"]')).toBeNull();
  });
});

describe('the GM-only badge', () => {
  it('shows on a hidden roll in the card and the log, and only there', () => {
    const hidden: DiceRollResult = { ...PLAIN, hidden: true };
    expect(toast(hidden).querySelector('.atlas-gm-only-badge')?.textContent).toBe('GM only');
    expect(entry(hidden).querySelector('.atlas-gm-only-badge')?.textContent).toBe('GM only');
    expect(toast(PLAIN).querySelector('.atlas-gm-only-badge')).toBeNull();
    expect(entry(PLAIN).querySelector('.atlas-gm-only-badge')).toBeNull();
  });
});
