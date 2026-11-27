// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, RollEntry, SharedRoll } from '../../../../src/app/online/protocol/index.ts';
import { LogState, TableLogPanel } from '../../../../src/app/online/tableLog/index.ts';
import { setLocale } from '../../../../src/app/i18n';
import { TRANSLATIONS } from '../../../../src/app/i18n/languages';

afterEach(() => {
  cleanup();
  setLocale('en', TRANSLATIONS);
});

const ME = 'abcdefghijklmnopqrst';
const KARA = 'kkkkkkkkkkkkkkkkkkkk';
const id = (n: number): string => n.toString(16).padStart(24, '0');

function side(n: number, kind: 'first' | 'second', margin: number, over: Partial<RollEntry> = {}, winner: 'first' | 'second' | null = 'first'): RollEntry {
  const roll: SharedRoll = {
    id: `r${n}`, timestamp: 0, formula: '1d20 vs 10', rolls: [{ die: 'd20', value: 10 + margin, max: 20 }], modifiers: 0, total: 10 + margin,
    check: { target: 10, direction: 'over', margin, success: margin >= 0, crit: null, rule: 'builtin:margin' },
    contest: { id: 'c1', side: kind, ...(kind === 'second' && { verdict: { winner, rule: 'builtin:contest-margin' } }) },
  };
  return { id: id(n), at: Date.now(), who: ME, name: 'Ash', kind: 'roll', token: null, roll, ...over };
}

function show(entries: readonly LogEntry[]): HTMLElement {
  const state = new LogState(() => ME);
  state.setPeople([{ id: ME, name: 'Ash' }, { id: KARA, name: 'Kara' }]);
  state.replace(entries);
  const actions = { say: vi.fn(), roll: vi.fn(), edit: vi.fn(), remove: vi.fn(), react: vi.fn(), clear: vi.fn() };
  return render(<TableLogPanel state={state} actions={actions} self={ME} moderator={false} canSend speakers={[{ key: 'self', name: 'Ash', kind: 'self', portrait: null }]} variant="embedded" onClose={() => undefined} />).container;
}

const rows = (container: HTMLElement): number => container.querySelectorAll('.atlas-online-log__row--roll').length;
const verdicts = (container: HTMLElement): string[] => [...container.querySelectorAll('.atlas-contest-verdict')].map((line) => line.textContent ?? '');
const checks = (container: HTMLElement): string[] => [...container.querySelectorAll('.atlas-check-line')].map((line) => line.textContent ?? '');

describe('the table log and contests', () => {
  it('shows the two rolls of a contest as one entry: both with their check lines, then the verdict', () => {
    const container = show([side(1, 'first', 5), side(2, 'second', 2)]);
    expect(rows(container)).toBe(1);
    expect(checks(container)).toEqual(['Success by 5', 'Success by 2']);
    expect(verdicts(container)).toEqual(['First side wins']);
    expect(container.textContent).toContain('First side');
    expect(container.textContent).toContain('Second side');
  });

  it('says Tie, and in Chinese 平局', () => {
    expect(verdicts(show([side(1, 'first', 2), side(2, 'second', 2, {}, null)]))).toEqual(['Tie']);
    cleanup();
    setLocale('zh', TRANSLATIONS);
    expect(verdicts(show([side(1, 'first', 2), side(2, 'second', 2, {}, null)]))).toEqual(['平局']);
  });

  it('keeps other rolls beside the pair as rows of their own, in order', () => {
    const plain: RollEntry = { ...side(3, 'first', 0), roll: { ...side(3, 'first', 0).roll, id: 'p', formula: '1d20' } };
    delete (plain.roll as { contest?: unknown }).contest;
    delete (plain.roll as { check?: unknown }).check;
    const container = show([side(1, 'first', 5), plain, side(2, 'second', 2)]);
    expect(rows(container)).toBe(2);
  });

  it('shows a side whose partner is not in the log as an ordinary roll, and does not join two rollers', () => {
    expect(rows(show([side(2, 'second', 2)]))).toBe(1);
    cleanup();
    const container = show([side(1, 'first', 5, { who: KARA, name: 'Kara' }), side(2, 'second', 2)]);
    expect(rows(container)).toBe(2);
  });
});
