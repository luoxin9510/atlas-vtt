// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import { createTableStore } from '../../../apps/play/src/state/tableStore.ts';
import { YourTurnBanner } from '../../../apps/play/src/ui/YourTurnBanner.tsx';

initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const vibrate = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});
afterEach(() => {
  cleanup();
  vibrate.mockClear();
  vi.useRealTimers();
});

describe('YourTurnBanner', () => {
  it('shows on a turn, buzzes once and hides after 8 s', () => {
    const store = createTableStore();
    render(<YourTurnBanner store={store} lowPower={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => store.setState({ yourTurnAt: 1 }));
    expect(screen.getByRole('alert').textContent).toBe('Your turn!');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200]);
    act(() => { vi.advanceTimersByTime(7999); });
    expect(screen.queryByRole('alert')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('hides when tapped', () => {
    const store = createTableStore();
    store.setState({ yourTurnAt: 1 });
    render(<YourTurnBanner store={store} lowPower={false} />);
    fireEvent.click(screen.getByRole('alert'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(store.getState().yourTurnAt).toBeNull();
  });

  it('does not buzz in low-power mode', () => {
    const store = createTableStore();
    render(<YourTurnBanner store={store} lowPower />);
    act(() => store.setState({ yourTurnAt: 1 }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
