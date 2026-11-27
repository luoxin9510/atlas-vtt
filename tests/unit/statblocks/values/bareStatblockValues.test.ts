import { describe, expect, it } from 'vitest';
import { defaultDiceSet } from '../../../../src/app/gameSystems/diceSetResolution';
import { valueForText, valueProblem } from '../../../../src/app/statblocks/editor/statblock-pane/valuePatches';
import type { TemplateField } from '../../../../src/app/statblocks/model/templateTypes';
import { bareFacesOfStatblock } from '../../../../src/app/statblocks/resolve/statblockBareFaces';
import { sheetState } from '../../../../src/app/statblocks/render/sheetState';
import { namedReferenceRolls, referenceRolls } from '../../../../src/app/statblocks/values/referenceRolls';
import { textProblem, valueMisfit } from '../../../../src/app/statblocks/values/valueFit';
import { bonusLink, valueRoll } from '../../../../src/app/statblocks/values/valueRolls';
import { templateOf } from '../render/sheetTestKit';

const DICE: TemplateField = { key: 'damage', label: 'Damage', type: 'dice' };
const BARE = { ...defaultDiceSet(), id: 'bare-d6', name: 'Bare', dice: [{ count: 1, sides: 6 }], bareDie: true as const };

describe('statblock values with bare-faced dice', () => {
  it('a Dice field takes them only where the set opts in', () => {
    expect(textProblem(DICE, '1d+1')).not.toBeNull();
    expect(textProblem(DICE, '1d+1', 6)).toBeNull();
    expect(valueMisfit(DICE, '1d+2')).not.toBeNull();
    expect(valueMisfit(DICE, '1d+2', 6)).toBeNull();
  });

  it('the pane stores them as typed and raises no problem', () => {
    expect(valueProblem(DICE, '1d+1')).not.toBeNull();
    expect(valueProblem(DICE, '1d+1', 6)).toBeNull();
    expect(valueForText(DICE, '1d+1', 6)).toBe('1d+1');
  });

  it('a value rolls as one roll', () => {
    expect(valueRoll('1d+2', undefined)).toBeNull();
    expect(valueRoll('1d+2', undefined, 6)).toBe('1d+2');
    expect(bonusLink('1d+2', true)).toBeNull();
    expect(bonusLink('1d+2', true, 6)).toBeNull();
    expect(bonusLink('2', true, 6)).toBe('+2');
  });

  it('references fill into them', () => {
    const lookup = (path: string): number | undefined => (path === 'str' ? 3 : undefined);
    expect(referenceRolls('1d + @str', lookup)).toEqual([]);
    expect(referenceRolls('1d + @str', lookup, 6)).toEqual([{ formula: '1d+3', named: '1d+3[Str]' }]);
    expect(namedReferenceRolls(['1d + @str'], lookup, 6).get('1d+3')).toBe('1d+3[Str]');
  });

  it('the sheet state carries the faces for its blocks', () => {
    const template = templateOf([DICE], []);
    expect(sheetState({ template, record: {}, mode: 'view' }).defaultFaces).toBeUndefined();
    expect(sheetState({ template, record: {}, mode: 'view', defaultFaces: 6 }).defaultFaces).toBe(6);
  });
});

describe('the faces of a statblock', () => {
  const sets = [BARE];
  it('come from its template set, else the collection set, only where that set opts in', () => {
    expect(bareFacesOfStatblock('bare-d6', defaultDiceSet(), sets)).toBe(6);
    expect(bareFacesOfStatblock(undefined, BARE, sets)).toBe(6);
    expect(bareFacesOfStatblock('missing', BARE, sets)).toBe(6);
    expect(bareFacesOfStatblock(undefined, defaultDiceSet(), sets)).toBeUndefined();
  });
});
