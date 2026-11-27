import type { App } from 'obsidian';
import { statblockDiceSet } from '../../gameSystems/diceSetResolution';
import { setRoll } from '../../gameSystems/diceSets';
import { diceSetOfCollection, diceSetsOf } from '../../services/diceSets/collectionDiceSets';
import { collectionIdOfPath } from '../../services/assetPaths';
import type { DiceSet } from '../../types/diceSetTypes';

/**
 * The roll a number rolled as a check is the target of (`3d6` for `15`: `3d6 vs 15`): the default roll of
 * the set a bare bonus rolls with (`statblockDiceSet`): the template's, else the collection's.
 */
export function checkRollOfStatblock(templateSetId: string | undefined, collectionSet: DiceSet, sets: readonly DiceSet[]): string {
  return setRoll(statblockDiceSet(templateSetId, collectionSet, sets).dice);
}

/** The same for a statblock shown in the app, its collection found as for `statblockBareFaces`. */
export function statblockCheckRoll(app: App, templateSetId: string | undefined, collectionId: string | null | undefined, notePath?: string): string {
  const collection = diceSetOfCollection(app, collectionId ?? collectionIdOfPath(notePath));
  return checkRollOfStatblock(templateSetId, collection, diceSetsOf(app));
}
