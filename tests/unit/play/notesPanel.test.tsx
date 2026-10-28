// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '../../../apps/play/src/i18nInit.ts';
import type { SharedNote } from '../../../src/app/online/protocol/fork.ts';
import { NotesPanel } from '../../../apps/play/src/ui/NotesPanel.tsx';

afterEach(cleanup);
initLanguage({ getItem: () => 'en', setItem: () => undefined }, 'en');

const id = (n: number): string => String(n).repeat(24);
const note = (n: number, title: string, group?: string): SharedNote => ({
  id: id(n), title, ...(group !== undefined && { group }), text: { hash: String(n).repeat(64), size: 5, mime: 'text/markdown' } as SharedNote['text'],
});
const bytes = (text: string): { bytes: Uint8Array; mime: string; width: null; height: null } => ({ bytes: new TextEncoder().encode(text), mime: 'text/markdown', width: null, height: null });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('NotesPanel', () => {
  it('lists ungrouped notes first, then groups by name, titles sorted', async () => {
    const assets = { load: vi.fn(() => Promise.resolve(null)) };
    render(<NotesPanel notes={[note(1, 'Zed', 'Beta'), note(2, 'Bee'), note(3, 'Ant', 'Alpha'), note(4, 'Aaa'), note(5, 'Cat', 'Alpha')]} assets={assets} />);
    const order = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(order).toEqual(['Alpha', 'Beta']);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Aaa', 'Bee', 'Ant', 'Cat', 'Zed']);
  });

  it('says so when nothing is shared', () => {
    render(<NotesPanel notes={[]} assets={{ load: vi.fn() }} />);
    expect(screen.getByText('No shared notes')).toBeTruthy();
  });

  it('opens a note, renders its text, follows an in-app link and goes back', async () => {
    const texts: Record<string, string> = { [String(1).repeat(64)]: `# Hello\n\n[other](atlas-note:${id(2)})`, [String(2).repeat(64)]: 'Second text' };
    const assets = { load: vi.fn((ref: { hash: string }) => Promise.resolve(bytes(texts[ref.hash]!))) };
    render(<NotesPanel notes={[note(1, 'One'), note(2, 'Two')]} assets={assets} />);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeTruthy();
    expect(assets.load).toHaveBeenCalledWith(expect.objectContaining({ hash: String(1).repeat(64) }), null);
    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(await screen.findByText('Second text')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(within(document.body).getByRole('button', { name: 'One' })).toBeTruthy();
  });

  it('closes a note that leaves the list while open with a line', async () => {
    const assets = { load: vi.fn(() => Promise.resolve(bytes('Body'))) };
    const one = note(1, 'One');
    const { rerender } = render(<NotesPanel notes={[one]} assets={assets} />);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    await screen.findByText('Body');
    rerender(<NotesPanel notes={[]} assets={assets} />);
    expect(screen.getByText('This note is no longer shared')).toBeTruthy();
    expect(screen.queryByText('Body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('No shared notes')).toBeTruthy();
  });

  it('shows a failed load with a retry', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(bytes('Second try'));
    render(<NotesPanel notes={[note(1, 'One')]} assets={{ load }} />);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(await screen.findByText('Could not load the note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Second try')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
