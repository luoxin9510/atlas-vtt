import type { App } from 'obsidian';
import { statblockDiceSet } from '../../gameSystems/diceSetResolution';
import { bareDieFaces } from '../../gameSystems/diceSets';
import { diceSetOfCollection, diceSetsOf } from '../../services/diceSets/collectionDiceSets';
import { collectionIdOfPath } from '../../services/assetPaths';
import type { DiceSet } from '../../types/diceSetTypes';

/**
 * The faces of a die a statblock writes without them (`1d+1`): its set's first die where the set
 * opts in (`bareDie`), else undefined. The set is the one a bare bonus rolls with
 * (`statblockDiceSet`): the template's, else the collection's.
 */
export function bareFacesOfStatblock(templateSetId: string | undefined, collectionSet: DiceSet, sets: readonly DiceSet[]): number | undefined {
  return bareDieFaces(statblockDiceSet(templateSetId, collectionSet, sets));
}

/**
 * The same for a statblock shown in the app: `collectionId` is its collection where known
 * (the pane's), else the collection whose folder holds `notePath`; the d20 without one.
 */
export function statblockBareFaces(app: App, templateSetId: string | undefined, collectionId: string | null | undefined, notePath?: string): number | undefined {
  const collection = diceSetOfCollection(app, collectionId ?? collectionIdOfPath(notePath));
  return bareFacesOfStatblock(templateSetId, collection, diceSetsOf(app));
}
