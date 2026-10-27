import { FORMULA_LIMITS } from '../../../../src/app/tools/formulaTypes.ts';

/** The dice the tray offers, smallest first. */
export const DICE_FACES = [4, 6, 8, 10, 12, 20, 100] as const;
export type DieFaces = (typeof DICE_FACES)[number];

/** Dice of one kind the tray holds at most. */
export const MAX_PER_KIND = 20;
/** The largest bonus or penalty the tray writes (constants are at most four digits; three keep a sum safe). */
export const MAX_MODIFIER = 999;

export type DiceDraft = {
  readonly dice: Readonly<Record<DieFaces, number>>;
  readonly modifier: number;
};

export const EMPTY_DRAFT: DiceDraft = { dice: { 4: 0, 6: 0, 8: 0, 10: 0, 12: 0, 20: 0, 100: 0 }, modifier: 0 };

const total = (draft: DiceDraft): number => DICE_FACES.reduce((sum, faces) => sum + draft.dice[faces], 0);

/** One more die of `faces`; the draft itself once 20 of that kind (or the formula's dice limit) are held. */
export function addDie(draft: DiceDraft, faces: DieFaces): DiceDraft {
  if (draft.dice[faces] >= MAX_PER_KIND || total(draft) >= FORMULA_LIMITS.dice) return draft;
  return { ...draft, dice: { ...draft.dice, [faces]: draft.dice[faces] + 1 } };
}

/** The modifier moved by `delta`, kept within ±999. */
export function addModifier(draft: DiceDraft, delta: number): DiceDraft {
  const modifier = Math.max(-MAX_MODIFIER, Math.min(MAX_MODIFIER, draft.modifier + delta));
  return modifier === draft.modifier ? draft : { ...draft, modifier };
}

/** `"2d20 + 1d6 + 3"`, largest die first; null without a die (a bare number is no roll). */
export function formulaOf(draft: DiceDraft): string | null {
  const parts = [...DICE_FACES].reverse().filter((faces) => draft.dice[faces] > 0).map((faces) => `${draft.dice[faces]}d${faces}`);
  if (parts.length === 0) return null;
  const text = parts.join(' + ');
  if (draft.modifier === 0) return text;
  return draft.modifier > 0 ? `${text} + ${draft.modifier}` : `${text} - ${-draft.modifier}`;
}
