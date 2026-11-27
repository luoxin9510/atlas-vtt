import type { App } from 'obsidian';
import { t } from '../i18n';
import type { DiceRollInputs } from '../tools/DiceTool';
import { showNotice } from '../ui/notice';
import { gmOnlySwitchOf } from './gmOnlySwitch';

/** The local roller's random stream: dice, initiative and hit points joining a scene all roll with it. */
export const diceRandom = (): number => Math.random();

/** Keep the local roller's random stream, id format and label at the plugin boundary; `gmOnly` reads the GM's switch of `app`. */
export function offlineDiceInputs(app?: App): DiceRollInputs {
  return {
    random: diceRandom,
    rollId: (): string => `roll_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    gmOnly: gmOnlySwitchOf(app),
    roller: (): string => t('dice.player'),
    onFormulaError: (error): void => { showNotice(t(`dice.formulaError.${error.code}`)); },
  };
}
