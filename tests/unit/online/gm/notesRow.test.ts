// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNotesRow } from '../../../../src/app/online/gm/dock/notesRow.ts';

const lines = (count: number, capped: boolean): string[] => {
  const layer = document.createElement('div');
  renderNotesRow(layer, count, capped);
  return [...layer.children].map((c) => c.textContent ?? '');
};

describe('the dock row of shared notes', () => {
  it('says how many notes are shared, in the plural form the count needs', () => {
    expect(lines(1, false)).toEqual(['1 note shared']);
    expect(lines(7, false)).toEqual(['7 notes shared']);
  });
  it('adds the cap line when the cap was hit, and shows nothing for no notes', () => {
    expect(lines(500, true)).toEqual(['500 notes shared', 'Only the first 500 notes are shared']);
    expect(lines(0, false)).toEqual([]);
  });
});
