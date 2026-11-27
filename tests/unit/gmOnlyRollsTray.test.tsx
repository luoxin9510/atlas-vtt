// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BUILT_IN_DICE_SETS } from '../../src/app/gameSystems/builtInDiceSets';
import { SettingsService } from '../../src/app/services/SettingsService';
import { DiceDropdownMenu } from '../../src/app/react/components/dice/DiceDropdownMenu';
import { DiceTray } from '../../src/app/react/components/dice/DiceTray';
import type { DiceTool } from '../../src/app/tools/DiceTool';

const context = vi.hoisted(() => ({ app: {} as object, isPlayerView: false }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({
  useAtlasUI: () => ({ app: context.app, view: { getViewType: () => 'atlas-vtt' } }),
}));
vi.mock('../../src/app/react/ViewStoreContext', () => ({
  useAtlasStore: (selector: (state: { isPlayerView: boolean }) => unknown) => selector({ isPlayerView: context.isPlayerView }),
}));
vi.mock('../../src/app/react/hooks/useDicePreviews', () => ({ useDicePreviews: () => ({}) }));
vi.mock('../../src/app/packages/components/primitives/tooltip', () => ({
  LabelTooltip: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
}));

const rollDice = vi.fn(() => true);
const diceTool = { rollDice, rollingDice: () => ({ dice: [{ count: 1, sides: 20 }], crit: 'natural' }) } as unknown as DiceTool;
let settings: SettingsService;

beforeEach(() => {
  vi.useFakeTimers();
  rollDice.mockClear();
  context.app = {};
  context.isPlayerView = false;
  settings = new SettingsService(context.app as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const gmOnlyButton = (): HTMLElement => screen.getByRole('button', { name: 'GM only' });
const throwD20 = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Add a d20' }));
  fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
};

it('the tray button shows whether GM-only is on, and asks to toggle it', () => {
  const onToggle = vi.fn();
  const { rerender } = render(<DiceTray onRoll={vi.fn()} gmOnly={{ on: false, onToggle }} />);
  expect(gmOnlyButton().getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(gmOnlyButton());
  expect(onToggle).toHaveBeenCalledOnce();
  rerender(<DiceTray onRoll={vi.fn()} gmOnly={{ on: true, onToggle }} />);
  expect(gmOnlyButton().getAttribute('aria-pressed')).toBe('true');
  expect(gmOnlyButton().className).toContain('is-active');
});

it('the tray has no button where nobody else watches', () => {
  render(<DiceTray onRoll={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'GM only' })).toBeNull();
});

it('rolls openly while the switch is off', () => {
  render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={() => undefined} />);
  throwD20();
  expect(rollDice).toHaveBeenCalledWith('1d20');
});

it('rolls GM-only while the switch is on, and keeps it on through the next roll', () => {
  render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={() => undefined} />);
  fireEvent.click(gmOnlyButton());
  expect(settings.rollsGmOnly()).toBe(true);
  throwD20();
  throwD20();
  expect(rollDice).toHaveBeenNthCalledWith(1, '1d20', undefined, undefined, { visibility: 'gm' });
  expect(rollDice).toHaveBeenNthCalledWith(2, '1d20', undefined, undefined, { visibility: 'gm' });
  expect(gmOnlyButton().getAttribute('aria-pressed')).toBe('true');
});

it('starts on after a restart that stored it, and rolls openly again once switched off', () => {
  settings.setRollsGmOnly(true);
  render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={() => undefined} />);
  expect(gmOnlyButton().getAttribute('aria-pressed')).toBe('true');
  act(() => { fireEvent.click(gmOnlyButton()); });
  expect(settings.rollsGmOnly()).toBe(false);
  throwD20();
  expect(rollDice).toHaveBeenCalledWith('1d20');
});

it('keeps the side of advantage beside GM-only', () => {
  settings.setRollsGmOnly(true);
  const d20 = BUILT_IN_DICE_SETS.find((set) => set.id === 'builtin:d20')!;
  const advantageTool = { rollDice, rollingDice: () => d20 } as unknown as DiceTool;
  render(<DiceDropdownMenu diceTool={advantageTool} isOpen onToggle={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add a d20' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Advantage' }));
  fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
  expect(rollDice).toHaveBeenCalledWith('1d20', undefined, undefined, { advantage: 'advantage', visibility: 'gm' });
});
