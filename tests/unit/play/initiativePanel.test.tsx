// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import type { SharedCombatant, SharedInitiative } from '../../../src/app/online/protocol/initiative.ts';
import { InitiativePanel } from '../../../apps/play/src/ui/InitiativePanel.tsx';

afterEach(cleanup);
initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const combatant = (over: Partial<SharedCombatant>): SharedCombatant => ({
  initiative: 10, name: 'X', turn: false, sitsOut: false, art: null, ring: null, side: 'players', hp: null, ...over,
});
const list = (combatants: readonly SharedCombatant[], over: Partial<SharedInitiative> = {}): SharedInitiative => ({
  isActive: true, round: 2, bySides: false, firstSide: 'players', activeSide: null, combatants, ...over,
});
const assets = { load: vi.fn(() => Promise.resolve(null)) };

describe('InitiativePanel', () => {
  it('lists combatants in order with the turn marked and an unnamed one as Unknown', () => {
    render(<InitiativePanel assets={assets} initiative={list([
      combatant({ name: 'Ash', initiative: 18 }),
      combatant({ name: 'Brakka', initiative: 15, turn: true }),
      combatant({ name: null, initiative: 9, side: 'opponents', defeated: true }),
    ])} />);
    expect(screen.getByText('Round 2')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Ash18', 'Brakka15', 'Unknown9']);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(items[2]!.className).toContain('atlas-play-defeated');
  });

  it('heads each side when the fight is by sides', () => {
    render(<InitiativePanel assets={assets} initiative={list([
      combatant({ name: 'Ash' }), combatant({ name: 'Orc', side: 'opponents' }),
    ], { bySides: true })} />);
    expect(screen.getByText('Players')).toBeTruthy();
    expect(screen.getByText('Opponents')).toBeTruthy();
  });

  it('says so without a fight', () => {
    render(<InitiativePanel assets={assets} initiative={null} />);
    expect(screen.getByText('No fight yet')).toBeTruthy();
  });
});
