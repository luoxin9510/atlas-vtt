import { formatList, t } from '../i18n';
import type { TargetStep } from './checkTypes';
import type { DiceCrit } from '../tools/diceCrit';
import type { DiceRollResult } from '../types/diceTypes';

/**
 * The verdict of a check as one line under the total ("Success by 3",
 * "Critical failure by 11"), or null for a roll that was no check. The one
 * formatter the card, the log and the 3D panel share.
 */
export function checkLine(result: Pick<DiceRollResult, 'check'>): string | null {
  const { check } = result;
  if (check === undefined) return null;
  const n = Math.abs(check.margin);
  if (check.crit === 'success') return t('dice.check.critSuccess');
  if (check.crit === 'failure') return check.margin >= 0 ? t('dice.check.critFailureOnly') : t('dice.check.critFailure', { n });
  return check.success ? t('dice.check.success', { n }) : t('dice.check.failure', { n });
}

/** What a one-off modifier on a check's target is called in the steps that moved it: "Modifier". */
export function modifierStepLabel(): string {
  return t('dice.check.modifierStep');
}

/** A step as a line shows it: its name and signed value ("Agility +2", "Modifier −1"), or the signed value alone. */
function stepText({ label, value }: TargetStep): string {
  const signed = `${value < 0 ? '−' : '+'}${Math.abs(value)}`;
  return label === undefined || label === '' ? signed : `${label} ${signed}`;
}

/**
 * How a moved target was built as one line under the check line ("Target 15 → 17 (Agility +2 and
 * Modifier −1)"), or null where the check's target stayed as written (no steps recorded, or a roll
 * that was no check). Shared like `checkLine`.
 */
export function targetLine(result: Pick<DiceRollResult, 'check'>): string | null {
  const { check } = result;
  const steps = check?.targetSteps;
  if (check === undefined || check.baseTarget === undefined || steps === undefined || steps.length === 0) return null;
  return t('dice.check.target', { base: check.baseTarget, target: check.target, steps: formatList(steps.map(stepText)) });
}

/**
 * The critical result every display shows: the check's when the roll has one
 * (a natural maximum can still fail its check), else the dice's own. Visuals and
 * sounds read it; `result.crit` stays what the dice rolled.
 */
export function shownCrit(result: Pick<DiceRollResult, 'check' | 'crit'>): DiceCrit {
  const { check } = result;
  if (check === undefined) return result.crit ?? null;
  return check.crit === 'success' ? 'high' : check.crit === 'failure' ? 'low' : null;
}
