/**
 * What default dice are, said with the roll they belong to: the info mark of
 * a set's exploding dice tells it.
 */

import { DEFAULT_DICE_RULES } from '../../../gameSystems/diceRules';
import { parseRollGroups, setRollText } from '../../../gameSystems/diceSets';
import { t } from '../../../i18n';

/** What default dice are, said with the roll they belong to. */
export function defaultDiceExplanation(defaultRoll: string): string {
  const groups = parseRollGroups(defaultRoll) ?? parseRollGroups(DEFAULT_DICE_RULES.defaultRoll)!;
  const roll = groups.map(({ count, sides }) => `${count}d${sides}`).join('+');
  return t('diceLab.defaultDiceExplanation', { dice: setRollText(groups), roll });
}
