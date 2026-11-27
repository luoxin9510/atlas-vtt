// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../src/app/services/SettingsService';
import { DiceDropdownMenu } from '../../src/app/react/components/dice/DiceDropdownMenu';
import type { DiceTool } from '../../src/app/tools/DiceTool';
import { en } from '../../src/app/i18n/locales/en';
import { zh } from '../../src/app/i18n/locales/zh';

const context = vi.hoisted(() => ({ app: {} as object }));
vi.mock('../../src/app/react/root/AtlasUIContext', () => ({
  useAtlasUI: () => ({ app: context.app, view: { getViewType: () => 'atlas-vtt' } }),
}));
vi.mock('../../src/app/react/ViewStoreContext', () => ({
  useAtlasStore: (selector: (state: { isPlayerView: boolean }) => unknown) => selector({ isPlayerView: false }),
}));
vi.mock('../../src/app/react/hooks/useDicePreviews', () => ({ useDicePreviews: () => ({}) }));
vi.mock('../../src/app/packages/components/primitives/tooltip', () => ({
  LabelTooltip: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
}));

const rollDice = vi.fn((): unknown => ({ id: 'roll' }));
const onToggle = vi.fn();
const diceTool = { rollDice, rollingDice: () => ({ dice: [{ count: 1, sides: 20 }], crit: 'natural' }) } as unknown as DiceTool;
let settings: SettingsService;

beforeEach(() => {
  vi.useFakeTimers();
  rollDice.mockClear();
  rollDice.mockImplementation(() => ({ id: 'roll' }));
  onToggle.mockClear();
  context.app = {};
  settings = new SettingsService(context.app as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const field = (): HTMLInputElement => screen.getByRole('textbox', { name: en['dice.formulaInput.label'] }) as HTMLInputElement;
const type = (text: string): void => { fireEvent.change(field(), { target: { value: text } }); };
const enter = (): void => { fireEvent.keyDown(field(), { key: 'Enter' }); };

describe('the dice dropdown\'s formula input', () => {
  it('sits at the top of the dropdown with an example as its placeholder, in both languages', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    expect(field().placeholder).toBe('3d6 vs 14');
    expect(en['dice.formulaInput.placeholder']).toBe('3d6 vs 14');
    expect(zh['dice.formulaInput.placeholder']).toBe('3d6 vs 14');
    expect(zh['dice.formulaInput.label']).not.toBe(en['dice.formulaInput.label']);
    const tray = document.querySelector('.atlas-dice-panel')!;
    expect(tray.firstElementChild!.contains(field())).toBe(true);
  });

  it('rolls the typed check on Enter and closes', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('3d6 vs 14');
    enter();
    expect(rollDice).toHaveBeenCalledWith('3d6 vs 14');
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('rolls a typed formula too, trimmed', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('  2d6+3 ');
    enter();
    expect(rollDice).toHaveBeenCalledWith('2d6+3');
  });

  it('rolls GM-only while the switch is on', () => {
    settings.setRollsGmOnly(true);
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('1d20+5 ≥ 15');
    enter();
    expect(rollDice).toHaveBeenCalledWith('1d20+5 ≥ 15', undefined, undefined, { visibility: 'gm' });
  });

  it('shows the parser\'s error inline for text it cannot read, and rolls nothing', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('3d6 vs');
    enter();
    expect(screen.getByRole('alert').textContent).toBe(en['dice.formulaError.syntax']);
    expect(rollDice).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    type('3d6 vs 14');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names a too-long formula by the parser\'s own message', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type(`${'1+'.repeat(60)}1`);
    enter();
    expect(screen.getByRole('alert').textContent).toBe(en['dice.formulaError.length']);
    expect(rollDice).not.toHaveBeenCalled();
  });

  it('rolls nothing for empty text, and stays open when the tool refuses', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    enter();
    expect(rollDice).not.toHaveBeenCalled();
    rollDice.mockImplementation(() => null);
    type('1d20');
    enter();
    expect(rollDice).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('rolls contest text on Enter, with either separator, and closes', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('12 对 14');
    enter();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rollDice).toHaveBeenCalledWith('12 对 14');
    expect(onToggle).toHaveBeenCalledOnce();
    type('3d6 vs 12 against 14');
    enter();
    expect(rollDice).toHaveBeenLastCalledWith('3d6 vs 12 against 14');
  });

  it('rolls a contest GM-only while the switch is on', () => {
    settings.setRollsGmOnly(true);
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('12 against 14');
    enter();
    expect(rollDice).toHaveBeenCalledWith('12 against 14', undefined, undefined, { visibility: 'gm' });
  });

  it('shows the inline error for a contest with a side that is no check, and rolls nothing', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('12 对 abc');
    enter();
    expect(screen.getByRole('alert').textContent).toBe(en['dice.formulaError.syntax']);
    expect(rollDice).not.toHaveBeenCalled();
  });

  it('closes on Escape without rolling', () => {
    render(<DiceDropdownMenu diceTool={diceTool} isOpen onToggle={onToggle} />);
    type('3d6 vs 14');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onToggle).toHaveBeenCalledOnce();
    expect(rollDice).not.toHaveBeenCalled();
  });
});
