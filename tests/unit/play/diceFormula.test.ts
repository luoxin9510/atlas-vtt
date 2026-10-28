import { describe, expect, it } from 'vitest';
import { parseFormula } from '../../../src/app/tools/parseFormula.ts';
import { addDie, addModifier, EMPTY_DRAFT, formulaOf, type DiceDraft } from '../../../apps/play/src/ui/diceFormula.ts';

describe('diceFormula', () => {
  it('writes the largest die first and the modifier last, and parseFormula accepts it', () => {
    let draft: DiceDraft = EMPTY_DRAFT;
    draft = addDie(draft, 20);
    draft = addDie(draft, 20);
    draft = addDie(draft, 6);
    draft = addModifier(draft, 3);
    expect(formulaOf(draft)).toBe('2d20 + 1d6 + 3');
    expect(parseFormula('2d20 + 1d6 + 3')).toMatchObject({ ok: true });
  });

  it('has no formula without dice', () => {
    expect(formulaOf(EMPTY_DRAFT)).toBeNull();
    expect(formulaOf(addModifier(EMPTY_DRAFT, 4))).toBeNull();
  });

  it('ignores a 21st die of one kind', () => {
    let draft: DiceDraft = EMPTY_DRAFT;
    for (let i = 0; i < 21; i += 1) draft = addDie(draft, 6);
    expect(formulaOf(draft)).toBe('20d6');
  });

  it('writes a negative modifier with a minus', () => {
    const draft = addModifier(addDie(EMPTY_DRAFT, 8), -2);
    expect(formulaOf(draft)).toBe('1d8 - 2');
    expect(parseFormula('1d8 - 2')).toMatchObject({ ok: true });
  });

  it('keeps every formula the tray can write within the limits', () => {
    let draft: DiceDraft = EMPTY_DRAFT;
    for (const faces of [4, 6, 8, 10, 12, 20, 100] as const) for (let i = 0; i < 20; i += 1) draft = addDie(draft, faces);
    draft = addModifier(draft, 5000);
    expect(parseFormula(formulaOf(draft) ?? '')).toMatchObject({ ok: true });
  });
});
