// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollResult } from '../../src/app/types/diceTypes';
import { PlayerWindowService } from '../../src/app/services/PlayerWindowService';
import { cardTexts, emitRoll, setupPlayerDice } from '../helpers/playerDiceRolls';

// jsdom has no WebGL; the 3D panel's case is about what it shows, not about the device.
vi.mock('../../src/app/dice3d/stagePool', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/app/dice3d/stagePool')>(),
  canShowDice: (): boolean => true,
}));
afterEach(() => { act(() => PlayerWindowService.getInstance()?.destroy()); vi.restoreAllMocks(); });

const secret: DiceRollResult = {
  id: 'secret', timestamp: 0, formula: '1d20+4', rolls: [{ die: 'd20', value: 19, max: 20 }], modifiers: 4, total: 23, hidden: true,
};

describe('GM-only rolls in the player window', () => {
  it('never show as a card, while an open roll beside them does', () => {
    const { doc, bus } = setupPlayerDice('card');
    act(() => { bus.emit('dice-rolled', secret); });
    expect(cardTexts(doc)).toEqual([]);
    emitRoll(bus);
    expect(cardTexts(doc)).toHaveLength(1);
    expect(cardTexts(doc)[0]).toContain('17');
    expect(doc.body.textContent).not.toContain('23');
  });

  it('never throw 3D dice', () => {
    const { doc, bus } = setupPlayerDice('full');
    act(() => { bus.emit('dice-rolled', secret); });
    expect(doc.querySelector('.atlas-dice-roll')).toBeNull();
    expect(doc.querySelector('.atlas-dice-toast')).toBeNull();
  });
});
