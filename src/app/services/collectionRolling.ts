import type { App } from 'obsidian';
import { diceSetOfCollection } from './diceSets/collectionDiceSets';
import { offlineDiceInputs } from './offlineDiceInputs';
import type { OffMapRolls } from './statblockRolls';
import { rollingRules } from '../gameSystems/diceSets';
import { rollContestFormulas, rollDiceFormula, rollingWith } from '../tools/DiceTool';
import { hideGmOnly } from '../dice/rollVisibility';

/** What an off-map surface rolls with: no map is open, so a collection's dice set (or a template's) rolls. */
export type CollectionRolling = Required<Pick<OffMapRolls, 'roll' | 'rollContest' | 'rollingDice'>>;

/**
 * The rolling of every surface that shows its own rolls while no map is open (the statblock pane,
 * the workspace dice layer): the pure builders maps use, by the dice set of the collection
 * `collectionId()` names now (the d20 where it names none), GM-only as the GM's switch says. It only
 * rolls: showing the result is the surface's.
 */
export function collectionRolling(app: App, collectionId: () => string | null): CollectionRolling {
  return {
    roll: (formula, source, options) => {
      const { rules, shown } = rollingWith(diceSetOfCollection(app, collectionId()), options?.set);
      const inputs = offlineDiceInputs(app);
      const result = rollDiceFormula(formula, rules, inputs, shown, options?.advantage, false, options?.targetSteps);
      return result && { ...hideGmOnly(result, options?.visibility, inputs.gmOnly), source };
    },
    rollContest: (first, second, sources, options) => {
      const { rules, shown } = rollingWith(diceSetOfCollection(app, collectionId()), options?.set);
      const inputs = offlineDiceInputs(app);
      const sideAdvantage = { first: options?.sideAdvantage?.first ?? options?.advantage, second: options?.sideAdvantage?.second ?? options?.advantage };
      const pair = rollContestFormulas(first, second, rules, inputs, shown, options?.names, { sideAdvantage, sideSteps: options?.sideSteps });
      if (!pair) return null;
      const [one, two] = pair;
      hideGmOnly(one, options?.visibility, inputs.gmOnly);
      hideGmOnly(two, options?.visibility, inputs.gmOnly);
      return [{ ...one, source: sources[0] }, { ...two, source: sources[1] }];
    },
    rollingDice: (set) => rollingRules(rollingWith(diceSetOfCollection(app, collectionId()), set).rules),
  };
}
