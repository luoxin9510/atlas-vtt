// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import { JoinScreen } from '../../../apps/play/src/ui/JoinScreen.tsx';

afterEach(cleanup);
initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

function setup(): { onJoin: ReturnType<typeof vi.fn>; button: HTMLButtonElement; fill(name: string, code: string): void } {
  const onJoin = vi.fn();
  render(<JoinScreen onJoin={onJoin} />);
  const button = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement;
  const fill = (name: string, code: string): void => {
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Join code or your own code'), { target: { value: code } });
  };
  return { onJoin, button, fill };
}

describe('JoinScreen', () => {
  it('disables the button for an empty name, a 33-character name and a code that is not 6 digits', () => {
    const { button, fill } = setup();
    expect(button.disabled).toBe(true);
    fill('', '123456');
    expect(button.disabled).toBe(true);
    fill('a'.repeat(33), '123456');
    expect(button.disabled).toBe(true);
    fill('Ann', '12345');
    expect(button.disabled).toBe(true);
    fill('Ann', '123456');
    expect(button.disabled).toBe(false);
  });

  it('joins with the name and code', () => {
    const { onJoin, fill } = setup();
    fill('Ann', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(onJoin).toHaveBeenCalledWith({ name: 'Ann', code: '123456' });
  });

  it('shows why the player is back, and the legal links', () => {
    render(<JoinScreen reason="The GM removed you from this table" onJoin={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('The GM removed you from this table');
    expect(screen.getByRole('link', { name: 'Source' }).getAttribute('href')).toBe('https://github.com/luoxin9510/atlas-vtt');
    expect(screen.getByRole('link', { name: /Licence/ })).toBeTruthy();
  });
});
