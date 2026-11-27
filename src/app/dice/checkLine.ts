import { t } from '../i18n';
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
  if (check.crit === 'failure') return t('dice.check.critFailure', { n });
  return check.success ? t('dice.check.success', { n }) : t('dice.check.failure', { n });
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
