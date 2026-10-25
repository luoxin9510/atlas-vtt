/**
 * Type-only description of a `.atlasmap` scene file as Atlas writes it to disk. It is the
 * source of `docs/fork/atlasmap.schema.json`; nothing imports it at run time.
 *
 * Mirrors:
 * - the zustand persist envelope `{ state, version }` (`PersistedMapEnvelope`,
 *   src/app/services/MapPersistence.ts:80),
 * - the keys `partialize` emits (src/app/storeFactory.ts:1444-1472), typed from `ViewState`,
 * - the file-format conversions of src/app/resources/resourceFileFormat.ts (`tokenToFile`,
 *   `tokenSettingsToFile`, `sceneToFile`): tokens hold `hp`, `stress`, ... instead of `resources`.
 *
 * Regenerate the schema from the repository root with:
 *   npx -y ts-json-schema-generator@2.9.0 --path docs/fork/schema/atlasmapFile.ts --type AtlasMapFile --tsconfig docs/fork/schema/tsconfig.json --id https://github.com/luoxin9510/atlas-vtt/docs/fork/atlasmap.schema.json -o docs/fork/atlasmap.schema.json
 */
import type { Character, Token } from '../../../src/app/types';
import type { ResourceValue } from '../../../src/app/resources/resourceTypes';
import type { ViewState } from '../../../src/app/types/viewState';
import type { PinnedNotePreviewSlice } from '../../../src/app/stores/pinnedNotePreviewSlice';
import type { LootRollerSlice } from '../../../src/app/stores/lootRollerSlice';
import type { InitiativeEntry, InitiativeState } from '../../../src/app/types/initiativeTypes';

/**
 * The in-memory fields `partialize` reads: `ViewState` plus the two slice fields that
 * `ViewAtlasState` adds (src/app/storeFactory.ts:239-244). Imported from their own modules so the
 * schema does not need the whole store.
 */
type Scene = ViewState &
  Pick<PinnedNotePreviewSlice, 'pinnedNotePreviews'> &
  Pick<LootRollerSlice, 'lootRoller'>;

/** The fields `tokenToFile` writes in place of `resources` (resourceFileFormat.ts:64-81). */
export interface TokenResourceFileFields {
  hp?: ResourceValue;
  stress?: ResourceValue;
  /** `stress.max`, written beside `stress`. */
  maxStress?: number;
  hope?: ResourceValue;
  /** Every resource other than `hp`, `stress` and `hope`. */
  statblockResources?: Record<string, ResourceValue>;
  maxHpOverridden?: true;
  maxStressOverridden?: true;
  /** Overridden maxima of the keys other than `hp` and `stress`; the in-memory field of the same name also lists those two. */
  overriddenMax?: string[];
}

type WithFileResources<T> = Omit<T, 'resources' | 'overriddenMax'> & TokenResourceFileFields;

/**
 * A token as the file holds it: `resources` is replaced by the fields above. Spelled out as the two
 * kinds of `TokenEntity` (a union of `Omit`s would be merged into one object, making `name` required).
 */
export type TokenOnDisk = WithFileResources<Token> | WithFileResources<Character>;

/**
 * Token settings; `tokenSettingsToFile` adds the two bar switches (resourceFileFormat.ts:111-114), so
 * every file Atlas saves has them. They are optional because a new scene (`newSceneFile`) carries
 * none until Atlas first saves it, and a missing `showStressBars` hides the stress bar on load.
 */
export type TokenSettingsOnDisk = Scene['tokenSettings'] & {
  showHPBars?: boolean;
  showStressBars?: boolean;
};

/** An initiative entry with the vitals `sceneToFile` copies from its token (resourceFileFormat.ts:153-161). */
export type InitiativeEntryOnDisk = InitiativeEntry & {
  hp?: ResourceValue;
  stress?: ResourceValue;
  isDefeated: boolean;
};

export type InitiativeOnDisk = Omit<InitiativeState, 'entries'> & { entries: InitiativeEntryOnDisk[] };

/**
 * `objects` as saved. A scene created by `newSceneFile` has no `walls`, `lights` or `audios`
 * (src/app/services/newSceneFile.ts:28-60), so those are optional; Atlas back-fills `walls` and
 * `lights` when it loads the file.
 */
export type ObjectsOnDisk = Omit<Scene['objects'], 'tokens' | 'walls' | 'lights' | 'audios'> &
  Partial<Pick<Scene['objects'], 'walls' | 'lights' | 'audios'>> & {
    tokens: Record<string, TokenOnDisk>;
  };

type PersistedKeys =
  | 'schema'
  | 'version'
  | 'mapPath'
  | 'background'
  | 'grid'
  | 'camera'
  | 'widgetValues'
  | 'widgetSettings'
  | 'dmNotePath'
  | 'initiativeTrackerOpen'
  | 'diceLog'
  | 'pinnedNotePreviews'
  | 'lootRoller'
  | 'lighting'
  | 'exploredMask';

/** Exactly the keys of `partialize`; the replaced ones come from the on-disk types above. Atlas reads every key as optional. */
export type AtlasMapFileState = Partial<Pick<Scene, PersistedKeys>> & {
  objects?: ObjectsOnDisk;
  tokenSettings?: TokenSettingsOnDisk;
  initiative?: InitiativeOnDisk;
};

/** The zustand persist envelope. Atlas writes `version: 4` (`ATLAS_VERSION`) and refuses higher ones. */
export interface AtlasMapFile {
  state: AtlasMapFileState;
  version: 4;
}
