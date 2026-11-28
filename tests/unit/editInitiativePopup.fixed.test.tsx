// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditInitiativePopup } from '../../src/app/react/components/useEditInitiativePopup';
import type { InitiativeEntry } from '../../src/app/types/initiativeTypes';

afterEach(cleanup);

const entry = (initiative: number): InitiativeEntry => ({
  id: 'a', tokenId: 'a', name: 'A', initiative, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order: 0,
});

function opened(initiative: number, fixed: boolean, role: 'spinbutton' | 'textbox' = 'spinbutton'): HTMLInputElement[] {
  const hook = renderHook(() => useEditInitiativePopup(vi.fn(), 'left', fixed));
  act(() => hook.result.current.open(entry(initiative), document.createElement('div')));
  render(<>{hook.result.current.popup}</>);
  return screen.getAllByRole(role) as HTMLInputElement[];
}

describe('the Edit Initiative popup', () => {
  it('with fixed-value initiative takes decimals as written and has no modifier', () => {
    const fields = opened(0.1 + 0.2, true, 'textbox');
    expect(fields).toHaveLength(1);
    expect(fields[0]!.value).toBe('0.3');
    // Text, not a number field: a comma can be typed and an unreadable text is never silently emptied
    expect(fields[0]!.type).toBe('text');
    expect(fields[0]!.inputMode).toBe('decimal');
  });

  it('keeps the total and the modifier of dice initiative', () => {
    const fields = opened(14, false);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.value).toBe('14');
    expect(fields[0]!.step).not.toBe('any');
  });
});
