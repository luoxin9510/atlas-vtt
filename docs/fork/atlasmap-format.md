# Atlas VTT `.atlasmap` scene format and related vault JSON

Reference for an external program or AI agent that reads or writes Atlas scene files directly.

Baseline: upstream Atlas VTT 0.9.1, commit 5499fd87. All `file:line` references are relative to the repo root and refer to that baseline; line numbers drift on upstream changes, function names are the stable anchor. Anything marked **UNVERIFIED** was not confirmed by running code or by reading the exact lines. Machine-readable types: `docs/fork/atlasmap.schema.json` (authority for field types); this document is the authority for semantics.

Abbreviations: `MP` = `src/app/services/MapPersistence.ts`, `SF` = `src/app/storeFactory.ts`, `RFF` = `src/app/resources/resourceFileFormat.ts`, `LS` = `src/app/services/` (services dir).

---------------------------------------------------------------------------

## 1. Overview and quick rules for writers

A `.atlasmap` file is JSON written by zustand `persist`: `{ "state": {...}, "version": 4 }`. `state` is the output of `partialize` (SF:1445-1472). The loose reader type is `PersistedMapEnvelope` (MP:80-91); `MapFile` (MP:33) is only a reduced subset used by `MapLoader`, not the whole file.

Checklist for a writer:

1. Edit only scene files that are NOT open in Atlas (see section 10, R1). Atlas rewrites the whole file on any change and has no locking (LS/sceneFileWriter.ts:44-112).
2. Envelope: `{ "state": {...}, "version": 4 }`. Write `version: 4` in BOTH the envelope and `state.version` (MP:136, 226-233). Never write a number above 4: the file is refused (`newer`).
3. `state.schema` must be exactly `"atlas-vtt"` (LS/mapFileFallback.ts:8-42).
4. Write all eight object maps, each as `{}` when empty: `tokens, fog, pins, texts, drawings, walls, lights, audios` (`objects` replaces the default wholesale and `audios` is never back-filled, see 4.2 and R2).
5. Tokens: use the ON-DISK resource fields (`hp`, `stress`, `maxStress`, `hope`, `statblockResources`, `maxHpOverridden`, ...), not the in-memory `resources` map (RFF:32-81).
6. Write a complete `tokenSettings` object including `showHPBars` and `showStressBars` (replaced wholesale; a missing `showStressBars` hides stress bars, RFF:94-108).
7. Record key must equal the entity `id`; ids unique within the file across ALL kinds (section 7).
8. Coordinates: world pixels, y down, token `x/y` = centre; token `size` in logical cells; rotations in degrees (section 5).
9. Asset references: vault-relative paths, forward slashes, no leading slash, no `app://` URLs (section 8).
10. Place new scenes in `atlas-vtt/collections/<collection>/scenes/<name>.atlasmap`; the folder decides the collection (section 2).
11. Never touch `atlas-vtt/.atlas-data/` (device-local cache, settings, backups).
12. Rename or move referenced files through Obsidian (not the OS) so Atlas rewrites references (section 8).
13. Keep key order of the example and compact or 2-space JSON; both are accepted. Atlas will reformat the file on its next save.

---------------------------------------------------------------------------

## 2. File location and naming

- Extension: `.atlasmap` is the only scene extension the Atlas view opens (`isScenePath`, `src/app/utils/sceneFiles.ts:2,5`).
- Where Atlas creates scenes: `atlas-vtt/collections/<collectionId>/scenes/<name>.atlasmap` (`scenePathFor`, `LS/createScene.ts:24`; `createScene` 39-56). Scene name = file stem. `SceneNameTakenError` if the path exists.
- The collection of a scene is decided by its FOLDER (CLAUDE.md "The folder decides"; `collectionIdOfPath`, `src/app/services/assetPaths.ts:18-23`). A collection id is its folder name; names cannot contain `\ / : * ? " < > | # ^ [ ]` or start with `.` (assetPaths.ts:26,32-38).
- Registration, two routes:
  - Atlas's own: `createScene` writes the `.atlasmap` and the scene record inside `assetService.runExclusive` so the vault check does not adopt it twice (LS/createScene.ts:39-56).
  - External: write the `.atlasmap` into a collection folder. The vault check (`AssetService.reconcileWithVault`, at startup and about 1 s after the vault goes quiet, CLAUDE.md "Vault files and the asset index") adopts any `*.atlasmap` under `atlas-vtt/collections/<collection>/...` that no scene record owns (`src/app/services/vault-sync/assetAdoption.ts:77-91,107-123,154`), creating `SceneAsset {id: recoveredId('scene', path), type:'scene', name: stem, collection: folder, data:{mapPath}}` with empty tags. Reserved paths (`snapshots`, `loot-history`, `tables` at the collection root) are skipped (vault-sync/reservedPaths.ts:7,14-18).
- Scene record: `atlas-vtt/collections/<c>/scenes/<id>.json` with `atlasRecord` envelope (section 9). Not required for an external scene; adoption derives it.
- Asset index `atlas-vtt/.atlas-data/assets-metadata.json` is a device-local CACHE rebuilt from vault files; never edit it (section 9.8).
- Thumbnail: `<scene>.thumb.jpg` next to the `.atlasmap` for scenes under `scenes/` (`mapThumbnailPath`, LS/MapThumbnailService.ts:145-163; `getDataFilePath` remaps only `.../maps/<x>.thumb.jpg` into `.atlas-data`, `src/app/utils/dataFileMigration.ts:264-320`). A generated cache of the GM render; the scene does not reference it; a missing or stale thumbnail is not an error. Regeneration trigger: **UNVERIFIED**.
- Snapshots: separate files `atlas-vtt/collections/<c>/snapshots/<scene asset id>/<snapshot id>.json` (+ `.jpg`), keyed by the scene ASSET id, not the path (`src/app/snapshots/snapshotPaths.ts:14-27`; `SceneSnapshot {format:1; id; name; createdAt; updatedAt?; version?; state}`, snapshots/sceneSnapshotFormat.ts:16-32, state = scene state minus `mapPath, camera, diceLog, lootRoller`, line 15). The `.atlasmap` does not list them.
- Scene identity is the asset id (record / derived), not stored in the `.atlasmap`.

---------------------------------------------------------------------------

## 3. Top-level structure

```
{ "state": { ...keys below... },
  "version": 4 }
```

The envelope holds exactly `state` and `version` (key order `state`, `version` as Atlas writes them, MP:160). Reader validation of the envelope (`isPersistedMapEnvelope`, MP:113-118; `isLegacyMapFile`, MP:105-110): raw is a non-array object; `version` undefined or a number; `state` present and an object (a missing `state` is a `structure` error, so `{}` is rejected while `{"state":{}}` is accepted); `state.objects`, `state.camera`, `state.grid` each undefined, null or a plain object; if `objects` is an object, `objects.tokens` undefined, null or a plain object (an array fails). Nothing deeper is validated at parse time.

`state` keys that Atlas emits (exactly the `partialize` list, SF:1445-1472). All are optional on read; absent keys keep initial defaults (`createInitialState`, SF:284-331), except that present keys replace the default whole (shallow merge, SF:1475-1488).

| key | type (source) | default if absent | meaning |
|---|---|---|---|
| `schema` | `"atlas-vtt"` (types/viewState.ts:36) | `"atlas-vtt"` | constant; write it |
| `version` | number (viewState.ts:37) | 4 | inner version; lower values bumped to 4 on load |
| `mapPath` | `string \| null` | set on load | repeats the scene's own vault path; always overwritten with the real path on load (MP:238); rewritten on rename |
| `background` | `string \| null` | null (empty 20x20-cell world) | vault path of the map image |
| `grid` | `GridState \| null` (types/gridTypes.ts:11-47) | null (MapController builds one) | section 4 / 5.9 |
| `objects` | `{tokens, fog, pins, texts, drawings, walls, lights, audios, lightZones?}` (viewState.ts:46-57) | all `{}` | the map entities; replaced WHOLESALE if present |
| `camera` | `{x, y, scale}` (gridTypes.ts:5) | `{0,0,1}` | GM viewport: world px + zoom |
| `widgetValues` | `Record<widgetId, number>` | `{}` | current value of counter/clock widgets (see 5.12) |
| `widgetSettings` | `WidgetSettings` (types/widgetTypes.ts:65) | `{widgets:{}, globalVisible:true, position:'top', scale:1}` (SF:270-275) | scene widgets; collection-scope widgets are stripped on write (utils/collectionWidgets.ts:108) |
| `dmNotePath` | `string \| null` | null | vault path of the DM note |
| `tokenSettings` | `{showNameplates, hiddenResources, showInstanceBadges, tokenRingSize}` + file-only `showHPBars`, `showStressBars` | `{showNameplates:false, hiddenResources:[], showInstanceBadges:true, tokenRingSize:1}` | replaced wholesale; write all fields |
| `initiative` | `InitiativeState` (types/initiativeTypes.ts:123) | `{entries:[], currentIndex:-1, round:0, isActive:false, config:{autoSort:true}}` | combat tracker, section 5.11 |
| `initiativeTrackerOpen` | boolean | false | tracker panel open (UI state persisted) |
| `diceLog` | `DiceRollResult[]` (types/diceTypes.ts:5) | `[]` | max 20, newest first |
| `pinnedNotePreviews` | `Record<anchorId, PinnedNotePreview>` (stores/pinnedNotePreviewSlice.ts) | `{}` | floating note windows |
| `lootRoller` | `LootRollerState` (stores/lootRollerSlice.ts:17-31) | `{open:false, disabledViews:[], excludedRarities:[], count:1, pane:'results'}` | sanitised by `readLootRollerState` |
| `lighting` | `SceneLighting` (types/lightingTypes.ts:4-31) | `{enabled:false, ambient:0.1}` | merged over defaults by `readSceneLighting` (lighting/sceneLightingOptions.ts:108-115) |
| `exploredMask` | `string \| null` | null | PNG data URL of explored memory; must match `^data:image/png;base64,...$` else null (lighting/exploredMaskCodec.ts:4) |

Never persisted (do not write): selection/tool/drag state, `isPlayerView`, `mapLoaded`, `persistenceEnabled`, `currentCollectionId`, `exploredEdits`, `partyValues`, UI slice state, undo history (SF:1445-1472, 1483-1486; stores/uiSlice.ts:6). Unknown top-level `state` keys are tolerated on read (spread into the store, SF:1475-1488) and dropped on the next Atlas save. `state.name` appears in the `MapFile` type (MP:37) but is not emitted; whether any path writes it: **UNVERIFIED**.

---------------------------------------------------------------------------

## 4. Coordinate system and grid units

- World units are pixels of the map image at full resolution. Origin (0,0) is the top-left of the image; x grows right, y grows DOWN (CLAUDE.md "Map images"). A scene with no `background` has an empty world `(grid.size || 70) * 20` px square (`EMPTY_MAP_CELLS`, src/app/MapLoader.ts:15-26).
- Grid `size` = cell side in world px. Hex: FLAT-TO-FLAT distance (CLAUDE.md "Hexagonal Grids"). `offsetX/offsetY` = world position of the top-left of cell (0,0); for hex the top-left of the bounding box of hex (0,0).
- Grid `type`: `square`, `hex-horizontal` (flat-top, columns), `hex-vertical` (pointy-top, rows). Hex axial coordinates are derived, never stored (except the pin flag `hex: true`).
- Token `x,y` = CENTRE of the token in world px (`snapTokenCenter`, src/app/grid/gridPlacement.ts:36-47; `tokenCenterShift` 25-34). Snapped positions: odd footprints (size 1, 2, 3 ...) sit on a cell centre; even footprints (size 1.5, 2.5 ...; diameter `2*size-1` cells is even) sit where cells meet (square: cell centre + half a cell; hex: lower-right vertex). Unsnapped positions are legal.
- Token `size` is in logical cells: 1 = 1x1, 1.5 = 2x2, 2 = 3x3, 2.5 = 4x4, 3 = 5x5 (types.ts:67). Diameter in cells = `2*size - 1` (src/app/pixi/token-renderer/tokenSizing.ts:21-23). Default 1.
- Rotation is DEGREES everywhere (tokens 0-360, lights, text, `mapStretch.rotation`). Token rotation 0 faces the art's up, positive clockwise on screen (types.ts:65; CLAUDE.md "Vision cone"). Light rotation: 0 faces up, clockwise (lightingTypes.ts:101).
- Units: token/pin/text/drawing/fog/wall/light positions, audio radii (`innerRadius/outerRadius`, audioTypes.ts:6-10) and light-zone polygons are world px. Light `bright/dim` and vision `range/darkvision/tremorsense` are GAME UNITS (feet/metres per collection), converted by `gameUnitsToWorld` (lighting/lightingUnits.ts) using `grid.unitType`, `grid.unitDistance`, `grid.unitDistanceOverride`.
- `grid.mapStretch` (`src/app/grid/mapStretch.ts:11-16,41-49`): `{x, y, rotation?}`; x,y factors in [1, 1.5], rotation in degrees with |rotation| <= 5 (clockwise on screen). `readMapStretch` turns any invalid value into "none" (x = y = 1). When present the image is levelled about its centre and stretched; the world origin becomes the corner of the box holding the result. `grid.size`, `offsetX/Y` AND all object coordinates are then in the STRETCHED world. Atlas moves objects with the map when it changes stretch (`grid/mapStretchObjects.ts`); an external writer that sets or changes `mapStretch` must transform object coordinates itself (`imageToWorld`, mapStretch.ts:77).
- Elevation: no `elevation` field in the token types (grep of `src/app/types.ts` and `src/app/types/` found none). Token stacking order = `token.layer` (higher on top, unset 0; src/app/stores/tokenStacking.ts:3-20).
- Camera `{x, y, scale}`: GM viewport in world coordinates and zoom factor.

---------------------------------------------------------------------------

## 5. Object kinds

All entity collections are `Record<id, entity>` with `entity.id === key` and a `kind` discriminator. Types: `src/app/types.ts` unless stated. Required fields are marked (req); everything else is optional.

### 5.1 Tokens `objects.tokens` (types.ts:32-104)

`kind: 'token' | 'character'`.

| field | type | notes |
|---|---|---|
| `id` (req) | string | = record key |
| `kind` (req) | `'token'`/`'character'` | |
| `x`, `y` (req) | number | centre, world px |
| `imagePath` (req) | string | vault path of token art |
| `name` | string | required for `character`; no name on `token` |
| `size` | number | cells, default 1 |
| `rotation` | number | degrees |
| `layer` | number | stacking, default 0 |
| `showRing` | boolean | default true |
| `ringColor` | string | hex |
| `showNameplate` | boolean | default false |
| `isHidden` | boolean | hidden from players |
| `side` | string | `players`, `opponents` or a custom side id |
| `tags` | string[] | |
| `assetId` | string | library token asset it came from |
| `instanceNumber` | number | numbering of copies |
| `offMap` | `true` | off the map (e.g. in the initiative tray) |
| `conditions` | string[] | ids of `ConditionDefinition` in the collection settings |
| `conditionValues` | `Record<conditionId, number>` | valued conditions; missing = 1 (utils/conditionValues.ts) |
| `vision` | `TokenVision` | `{enabled, range?, darkvision?, tremorsense?, angle? (1-360 deg), senses?: TokenSense[]}` (lightingTypes.ts:139-160; senseTypes.ts); game units |
| `light` | `LightEmission` | emitted light, see 5.4 |
| `difficulty`, `notePath`, `statblockPath`, `statblockName` | character only | `notePath`/`statblockPath` vault paths |
| `overriddenMax` | string[] | resource keys whose max was set by hand |

Character link to a statblock: `statblockPath` = vault path of the statblock note. Atlas's own linking (`TokenStatblockLinkService.linkTokenToStatblock`, src/app/services/TokenStatblockLinkService.ts:~108-170) also writes the token art into the note's `image` field, so the link is two-sided (CLAUDE.md:180). Whether Atlas repairs a one-sided link: **UNVERIFIED**; set both.

On-disk resource fields (the in-memory `resources` map is NOT how tokens are saved; `tokenToFile`, RFF:64-81; read by `tokenFromFile`, RFF:32-61):

| on-disk field | meaning |
|---|---|
| `hp` | resource key `hp`: `{current, max}`, or a bare number n (read as `{current:n, max:max(n,100)}`) |
| `stress` | resource key `stress`, same shapes; bare-number max = `maxStress` if > 0 else 10 |
| `maxStress` | number; written as `stress.max` |
| `hope` | resource key `hope`; bare-number max 10 |
| `statblockResources` | `Record<key, {current, max}>` for every other resource key (bare number: max 0) |
| `maxHpOverridden`, `maxStressOverridden` | `true` puts `hp`/`stress` in `overriddenMax` |
| `overriddenMax` | string[] of the other overridden keys |

Rules: if none of `hp, stress, maxStress, hope, statblockResources, maxHpOverridden, maxStressOverridden` is present the token passes through unchanged (RFF:19,32-61). An existing `resources` object in the file is kept under the file fields (file fields win; RFF:57-58) but older Atlas versions do not read it, so do not rely on it. Invalid entries (neither finite number nor `{current:number, max:number}`) are silently dropped. Resource keys come from the collection's `settings.resources` (default `hp`, max 6, `MAX_RESOURCES`, src/app/resources/resourceTypes.ts:47). Atlas also writes `snapped` on added characters (SF:609-611); not in the type, use: **UNVERIFIED**.

### 5.2 Fog `objects.fog` (types/fogTypes.ts)

Not a bitmap: an ordered list of paint/erase operations drawn in order onto a canvas (`FogCanvasCompositor`). Order = record key order / `timestamp`.

Base: `id`, `kind: 'fog'`, `timestamp` (ms, req), `isErasing` (req; true = erase, destination-out), `offsetX?`, `offsetY?` (drag offset, default 0).

| `type` | extra fields (world px) |
|---|---|
| `brush` | `points: {x,y}[]`, `brushRadius` |
| `lasso` | `points: {x,y}[]` (polygon fill) |
| `rectangle` | `x, y, width, height` (Atlas writes `x,y` from its rect, FogOfWarRenderer.ts:600-617; that x,y is the top-left corner is **UNVERIFIED**) |

Fog is separate from explored memory (`state.exploredMask`). `migrateFogData` (MP:318-340, used by the `MapLoader` view) discards ALL fog if the first value lacks `kind: 'fog'`.

### 5.3 Walls and doors `objects.walls` (types/wallTypes.ts)

`{id, kind:'wall', type:'solid'|'door'|'secret-door', p1:{x,y}, p2:{x,y}}` (req) plus: `direction?: 'left'|'right'` (one-way; unset blocks both sides), `closed?` (doors only, default true = blocks), `locked?` (doors; locked doors do not toggle), `blocks?: 'sight'|'light'` (unset = both), `limited?` (feature-flagged off, `LIMITED_WALLS=false`; kept in file), `chainId?` (groups segments drawn in one action).

`direction` geometry: normal for `left` = (-dy, dx)/len, for `right` = (dy, -dx)/len, p1 to p2 (`wallNormal`, src/app/vision/visionGeometry.ts:78-90). Which side that is visually (y is down): **UNVERIFIED**. Walls are never grid-snapped. Reader `readWall` (lighting/lightingObjects.ts, ~line 76) ignores walls without finite `p1`/`p2` but keeps them in the file. Door toggle flips `closed = !(closed ?? true)` unless locked (SF:1178-1185).

### 5.4 Lights, light zones, scene lighting

Lights `objects.lights` (lightingTypes.ts:93-109): `{id, kind:'light', x, y, emission}` req; `hidden?` (switched off), `rotation?` (deg), `activeBelowAmbient?` (0-1). Reader requires string `id`, finite `x`,`y`, valid emission (lighting/lightingObjects.ts:60-71); invalid lights are ignored but kept in the file (lightingObjects.ts:1-15).

`LightEmission` (lightingTypes.ts:54-90; also `token.light`): `bright` (req, game units), `dim` (req, >= bright), `color` hex (bad -> `#ffffff`), `intensity` (1 nominal; bad -> 1), `animation: 'none'|'torch'|'candle'|'pulse'|'magic'` (bad -> none), plus optional `sourceRadius`, `kind` (`candle|torch|lantern|magical|darkness|custom`), `darkness?: true`, `priority`, `angle` (1-359), `preset` (lightingObjects.ts:33-47). `bright`/`dim` not finite numbers: emission reads as none.

Light zones `objects.lightZones?` (optional): `{id, kind:'light-zone', polygon:{x,y}[] (>=3 points, world px, max 64 corners; first 64 zones read), ambient: 0-1, name?, ambientColor?}`. Key order matters: later zones lie over earlier ones (lighting/lightZones.ts:74).

Scene lighting `state.lighting` (lightingTypes.ts:4-31): `enabled` (req, default false), `ambient` 0-1 (default 0.1), optional `ambientColor`, `tokenVision` (unset = on), `exploredMemory` (unset = on), `exploredColor`, `unexploredColor`, `litThreshold` (0.25), `brightThreshold` (0.75), `sightOnDrop`, `darkSightLook: 'system'|'grey'|'colour'`, `darkSightTint`. Hex colours must be `#rrggbb`; invalid ones are deleted on load.

### 5.5 Drawings `objects.drawings` (types.ts:139-151)

`{id, kind:'drawing', timestamp, type:'pen'|'eraser'|'line'|'rectangle'|'circle'|'icon', points:{x,y}[], color, width, opacity}`; `icon?` (key into `MAP_ICON_SVG`, only for `type:'icon'`). `width` is line width in px, or footprint size for icons.

### 5.6 Text `objects.texts` (types.ts:115-137)

`{id, kind:'text', x, y, text, fontSize, fontFamily, color}` req; optional `backgroundColor, padding, borderRadius, opacity, width, height` (auto if unset), `align: 'left'|'center'|'right'`, `bold, italic, rotation` (deg), `scale` (default 1).

### 5.7 Note pins and note links `objects.pins` (types.ts:10-23)

`{id, kind:'pin', x, y, notePath}` req; optional `icon`, `label` (auto sequence for number/letter icons), `gmOnly`, `hex: true`, `readable: true`.

- `notePath` is a VAULT PATH (not wikilink text), optionally with a heading suffix `path/to/note.md#Heading` (tools/pinNoteLink.ts:9-16).
- `hex: true` links the note to the hex CELL containing (x,y); only meaningful on hex grids (on square it falls back to an ordinary pin).
- `readable: true`: players may read the note.
- A pin whose `notePath` ends in `.atlasmap` is a link to another scene (LS/FileReferenceService.ts:118; LS/sceneLinks.ts); details **UNVERIFIED**.

### 5.8 Audio `objects.audios` (types/audioTypes.ts:3-13)

`{id, kind:'audio', x, y, innerRadius, outerRadius, volume (0-1), soundId, loop}`; radii in world px (full volume inside inner, falloff to 0 at outer); `soundId` built-in key (e.g. `fire`) or `custom:<file>.ogg`. Not in the `MapFile` type; see R2 for why the `audios` map must always exist.

### 5.9 Grid `state.grid` (types/gridTypes.ts:11-47)

Required inside a grid object: `enabled`, `size`, `offsetX`, `offsetY`, `opacity`. Optional: `visible`, `snapToGrid`, `type` (default square), `color` (hex; unset = automatic), `scale`, `mapScale`, `unitType` (`feet|yards|meters|units`), `unitDistance` (copy of the collection value at creation; goes stale), `unitDistanceOverride` (the real per-scene override), `lineType` (`solid|dashed|dotted`), `lineWidth`, `measurementType` (`units|abstract`; legacy `daggerheart` -> `abstract`), `autoDetect: true` (align grid to the image on first load, then cleared), `mapStretch`, `cellNumbers` (`column-row|sequential|letter-number`), `cellNumberOpacity` (0-1). MapController forces in-memory `grid.enabled = true` at load (MapController.ts:74-117) and the renderer uses `opacity ?? 0.7`.

### 5.10 Initiative `state.initiative` (types/initiativeTypes.ts)

`{entries: InitiativeEntry[], currentIndex (-1 none), round, isActive, config:{autoSort}}` plus optional `sides`, `cards`, `satOut`. `entries` is an ARRAY; order matters together with `currentIndex`.

`InitiativeEntry`: `id` (`init_<ms>_<rand>`), `tokenId` (-> key in `objects.tokens`), `name`, `initiative`, `initiativeModifier`, `imagePath`, `isActive`, `isNPC`, `order`; optional `statblockPath`, `awaitingInitiative`, `modifierByHand`, `sitsOut`, `delayed`, `rolledModifier`, `tieBreak`, `card`.

On-disk copies: each entry also carries `hp`, `stress`, `isDefeated` copied from its token's resources (`sceneToFile`, RFF:151-163). They are STRIPPED on load (RFF:146; the tracker reads vitals from the token) and regenerated on save, so an external writer may omit them.

### 5.11 Widgets (`widgetSettings`, `widgetValues`) (types/widgetTypes.ts)

`widgetSettings = {widgets: Record<id, AnyWidget>, offWidgets?: string[], globalVisible, position: 'top'|'bottom'|'left'|'right', scale}`. Widget common fields: `id, type: 'counter'|'clock'|'timer', label, icon, visible, visibleToPlayers, value, order`, optional `color`, `scope: 'scene'|'collection'`; counter `{min?, max?}`; clock `{segments, showCount?}`; timer `{duration, direction:'down', running?:{since, remaining}}`. Atlas keeps counter/clock current values in `state.widgetValues[widgetId]`. A `running` timer is stopped on load (`pausedTimers`, MP:224-225). Collection-scope widgets are stripped on write and merged from collection settings on load. `offWidgets` = ids switched off in this scene.

Old files with `widgetSettings.widgets` but no `widgetValues` trigger a one-time migration (`migrateWidgetsToCollection`) that rewrites the file as compact JSON (MP:200-211; utils/widgetMigration.ts:32-39). Provide `widgetValues` (even `{}`) to avoid it.

### 5.12 tokenSettings

Memory shape `{showNameplates, hiddenResources: string[], showInstanceBadges, tokenRingSize}`. File shape adds `showHPBars`, `showStressBars` (`tokenSettingsToFile`, RFF:111-114): on read `hiddenResources` gains `hp` iff `showHPBars === false` and `stress` iff `showStressBars !== true`; legacy `showResources: false` hides both; the three switch keys are removed from memory (RFF:94-108). Write: `showHPBars: !hidden.includes('hp')`, `showStressBars: !hidden.includes('stress')`, plus `hiddenResources`.

### 5.13 Camera, diceLog, lootRoller, pinnedNotePreviews

- `camera {x, y, scale}`: world px and zoom; excluded from snapshots.
- `diceLog`: `DiceRollResult[]` (types/diceTypes.ts:5), at most 20, newest first; `source` may hold `tokenId, tokenImagePath, statblockPath`.
- `lootRoller`: `{open, position?, size?, disabledViews[], excludedRarities[], count (1-10), pane: 'results'|'history', selected?, lastRoll?}`; sanitised on read (stores/lootRollerSlice.ts:~55-80).
- `pinnedNotePreviews`: key = `anchorId` (a pin or token id); value `{anchorId, notePath, left, top, width, height, view?}`.

### 5.14 Zones, player view

No generic zone object exists; the only zone kind is `lightZones`. Player view state is not stored per scene (`isPlayerView` is excluded from `partialize`).

---------------------------------------------------------------------------

## 6. On-disk versus in-memory differences

| item | in memory | on disk | source |
|---|---|---|---|
| token resources | `resources`, `overriddenMax` | `hp`, `stress`, `maxStress`, `hope`, `statblockResources`, `maxHpOverridden`, `maxStressOverridden`, `overriddenMax` (other keys) | RFF:32-81 |
| tokenSettings | `hiddenResources` only | + `showHPBars`, `showStressBars` | RFF:94-114 |
| initiative entries | no vitals | + `hp`, `stress`, `isDefeated` | RFF:146,151-163 |
| `objects.walls`, `objects.lights` | always present | back-filled on load if missing | MP:213-218 |
| `objects.audios` | always present in initial state | NOT back-filled; absent in the file = undefined in memory | R2 |
| collection widgets | merged into `widgetSettings` | stripped | SF:1450 |
| `mapPath` | real path | repeated, overwritten on load | MP:238 |
| formatting | n/a | Atlas saves: compact JSON; `createScene` and `FileReferenceService` rewrites: 2-space | MP:160; createScene.ts:39-56; FileReferenceService.ts:142-174 |

---------------------------------------------------------------------------

## 7. Ids and cross-references

- Ids are client-generated strings, not UUIDs: `<prefix>_<Date.now()>_<random9>` with `random = Math.random().toString(36).slice(2, 11)`. Prefixes: token `tok_` (SF:582), character `char_` (SF:596), pin `pin_` (905), text `text_` (964), drawing `drawing_` (1004), fog `fog_` (1062), wall `wall_` (1146), light `light_` (1203), light zone `zone_` (1227), audio `audio_` (1252), initiative entry `init_` (stores/initiativeSlice.ts:79-81). Library-spawned tokens may use other ids (**UNVERIFIED**).
- Nothing validates the format. Requirements: record key === entity `id`; unique within the scene file. Selection uses one flat `selectedIds` namespace across kinds, so keep ids unique ACROSS kinds (use the prefixes).
- Cross-references inside a scene: `initiative.entries[*].tokenId` -> `objects.tokens` key; `pinnedNotePreviews` key and `anchorId` -> pin or token id; `walls[*].chainId` groups walls; `diceLog[*].source.tokenId` -> token id; `widgetValues` key -> `widgetSettings.widgets` key. How dangling references are handled is inconsistent: **UNVERIFIED**; avoid them.
- Cross-references out of the scene: `tokens[*].assetId` -> library token asset id; `conditions[*]` -> collection `settings.conditions[*].id`; resource keys -> collection `settings.resources[*].key`; `side` -> side ids.

---------------------------------------------------------------------------

## 8. Asset references

- All references are vault-relative paths with forward slashes and no leading slash. No `app://` URLs, no wikilink syntax. Where they occur: `background`; `tokens[*].imagePath/statblockPath/notePath`; `pins[*].notePath` (may end `#Heading`); `initiative.entries[*].imagePath/statblockPath`; `diceLog[*].source.tokenImagePath/statblockPath`; `pinnedNotePreviews[*].notePath`; `dmNotePath`; `mapPath`.
- Typical locations: map image in `atlas-vtt/assets/` (CLAUDE.md "Map images"); token art in `atlas-vtt/assets/` or `atlas-vtt/collections/<c>/tokens/` (library art tree, section 9.2).
- Legacy normalisation (`normalizeImagePath`, src/app/utils/pathUtils.ts:9-60: `app://` URLs and absolute paths become vault-relative; relative non-URL paths pass through) runs only in `migrateMapFile` (MP:288-311), not in the live-store load path. Write clean paths.
- Rename/move rewriter: `FileReferenceService` (LS/FileReferenceService.ts:142-174) calls `rewriteMapReferences` (LS/renamedPaths.ts:72-93) for every `.atlasmap` and snapshot in the vault, and the live store does the same via `retargetRenamedFile` (SF:661-663). It rewrites ONLY: `mapPath`, `background`, `objects.tokens[*].imagePath/statblockPath`, `objects.pins[*].notePath` (preserving `#heading`), `initiative.entries[*].imagePath/statblockPath`, `diceLog[*].source.tokenImagePath/statblockPath` (confirmed: `MapReferences`, renamedPaths.ts:44-56). NOT rewritten: `tokens[*].notePath`, `dmNotePath`, `pinnedNotePreviews[*].notePath`, `assetId`, `soundId`. Rewritten scene files are saved with 2-space JSON via `vault.process`, only if something changed.
- `TokenStatblockLinkService.ts:355-375` and `tokenRingSync.ts:40` also rewrite tokens in closed scenes.
- Missing assets: `AssetValidationService.validateMapAssets` (MapLoader.ts:58) shows a notice; a missing `background` yields a placeholder (MapLoader.ts:23-32). The file is not changed.

---------------------------------------------------------------------------

## 9. Related vault JSON files

### 9.1 Folder layout (`atlas-vtt/`)

```
library.json                         library facts (1 per vault)          services/library/libraryPaths.ts:7
assets-metadata.json                 LEGACY visible index, read only while no library.json exists   libraryPaths.ts:13
collections/<collectionId>/          id == folder name                    services/assetPaths.ts:3,9
  collection.json                    collection record (no id/name stored)  libraryPaths.ts:16,21
  install.json                       bundle import/export baseline (not an atlasRecord; do not touch)
  maps|scenes|encounters|players|characters|statblocks|tokens|notes/<id>.json   record files (assetFiles.ts:7-14,31)
  tokens/<art>.webp|png|...          token art (any image there becomes a token)
  snapshots/<sceneId>/  loot-history/<deviceId>.json  tables/     RESERVED (reservedPaths.ts:7,14-18)
system-presets/<Name>.json           user game-system presets             services/systemPresets/presetFiles.ts:25
assets/                              shared art; thumbnails/, encounter-thumbnails/
.atlas-data/                         HIDDEN, device-local cache/settings/backups
dice-sets/  statblock-templates/  campaigns/    exist; formats NOT traced here
```
All service paths above are under `src/app/services/`. Token and note record files live under the collection, `atlas-vtt/collections/<collection>/tokens/<id>.json` and `.../notes/<id>.json` (`recordFilePath`, services/vault-sync/assetFiles.ts:38-40), not at the vault-folder root. Record candidate regex: `^atlas-vtt/collections/<id>/(maps|scenes|encounters|players|characters|statblocks|tokens|notes)/.+\.json$`, sub-folders allowed, file name free (libraryPaths.ts:33-36). Folders under `collections/` starting with `.` are not collections (vault-sync/vaultListing.ts:57).

### 9.2 Record files (`atlasRecord`, format 1) (services/library/recordFile.ts)

- `RECORD_KEY = 'atlasRecord'` (6), `RECORD_FORMAT = 1` (9). Types: token, map, note, statblock, character, scene, encounter, player (11).
- Written as `JSON.stringify({...payload, atlasRecord: envelope}, null, 2)`: payload keys first, `atlasRecord` last (`serializeRecord`, 75-78). Envelope = `format: 1` + all asset fields except `data` and `filePath` (45-54); mirrored fields (encounter `tokens, difficulty, formation`; player `tokens, level, class`) are omitted from the envelope when equal to the payload copy (17-20, 50).
- Payload: scene/encounter/player/character/statblock = `asset.data` at top level (57-64); map = legacy fields `{id, name, mapFilePath, tags, collection, createdAt, modifiedAt}` (30-40); token and note = `{}`, so the file is only `{"atlasRecord": {...}}`.
- Reading (`parseRecordFile(text, path)`, 141-154): not JSON/object -> null (ignored); no `atlasRecord` -> payload-only legacy file; `format` missing/invalid counts as 1 (151). `assetFromEnvelope` (118-138): `collection` is ALWAYS replaced by the folder the file lies in (124); `tags` coerced to string[]; `createdAt` default 0; `modifiedAt` default `createdAt`.
- Acceptance (`isAssetRecord`, 105-115): non-empty `id`; `type` in the 8 types; string `name`; non-empty `collection` (file must be in a collection folder); `tags` string[]; numeric `createdAt`/`modifiedAt`; per-type required field (`hasRequiredFields`, 93-102): token `imagePath`, map `mapFilePath`, note `notePath`, encounter/player `tokens` array. File name is not checked against `id`. Unknown envelope fields are kept and written back (tests/unit/library/recordFile.test.ts:67-74).
- `format > 1`: record is read into the index but never rewritten, moved or deleted by Atlas (`newer`, services/library/libraryReader.ts:132; mergeShared.ts:32-36 `readOnly` stamp; libraryWriter.ts:45,84,102). Same for `collection.json` and `library.json` (`LIBRARY_FILE_FORMAT = 1`, collectionFile.ts:5). A file with no `format` counts as 1 and gets normalised. How the UI surfaces the read-only state: **UNVERIFIED**.
- Token record (`TokenAsset`, services/AssetService.ts:35-58), inside `atlasRecord`: req `format, id, type:'token', name, tags, collection, imagePath, createdAt, modifiedAt`; optional `showRing` (false = no frame, default true), `size` (multiplier, default 1), `thumbnailPath`, `statblockPath`, `playerCharacter` (only ever `true`). Only `isAssetRecord` is validated; bad `size/showRing/thumbnailPath/statblockPath` behaviour is **UNVERIFIED**. Ids Atlas makes: `${type}-${Date.now()}-${random6}` (AssetService.ts:968-970); any unique non-empty string is accepted. Per-token resource VALUES are NOT in the library record; only definitions live in collection settings.
- Token art ownership: art under `collections/<c>/tokens/` (any depth) belongs to `<c>` (vault-sync/recoveredTokens.ts:9); a record's collection is its record file's folder; the vault check re-homes it to the `imagePath` collection if different and that exists (assetRelink.ts:112-116). Art with no record is auto-adopted as `token-recovered-<hash(path)>` (recoveredTokens.ts:132-155). A record read by Atlas survives missing art (assetRelink.ts:53-65). `tokens/notes` JSON without `atlasRecord` is ignored (mergeLibraryChanges.ts:119-139).
- Note record: `NoteAsset {type:'note', notePath}` (AssetService.ts:66-69).
- Extra top-level keys outside `atlasRecord` in token/note files are DROPPED on Atlas's next rewrite (recordFile.ts:59).

### 9.3 Encounters (`encounters/<id>.json`) (AssetService.ts:101-106,132-140; recordFile.ts)

Payload at top level: `tokens: EncounterTokenRef[]`, optional `difficulty` (`easy|medium|hard|deadly`), `formation {gridType, pitch}` (src/app/encounters/encounterFormation.ts:38-42), `description`. Envelope adds `thumbnailUrl?` (generated image under `atlas-vtt/assets/encounter-thumbnails/`, omit when hand-writing).
- Token ref: req `id`, `name`, `imagePath` (`isGroupTokenRef`, services/assetMetadataGuards.ts:~38-46; malformed refs are dropped when adopting a file without `atlasRecord`, assetAdoption.ts:100); optional `x`, `y`, `statblockPath`, `size`, `cell {q,r}`, `offset {x,y}` (relative to anchor, needs `formation`), `state` (`TokenStateSnapshot`, types.ts:110). Whether `state` is stored in file or memory resource shape: **UNVERIFIED**.
- Keep `tokens` only at the top level; do not add it inside `atlasRecord` (recordFile.ts:130-135). Refs match library tokens by `id` for propagation/purge (AssetService.ts:627-658) and by `imagePath` for spawning; encounters saved from a map use map token ids, which propagation does not match (saveMapTokensAsEncounter.ts:~52, **UNVERIFIED**).
- Player groups (`players/<id>.json`): `tokens`, `level?`, `class?`, `thumbnailUrl?`, `data?`. Character/statblock JSON: opaque payload.
- File without `atlasRecord`: id = file stem, name = `payload.name` or prettified stem; id clash -> `encounter-recovered-<hash>` (assetAdoption.ts:94-105).

### 9.4 `collection.json` (services/library/collectionFile.ts)

Written `{format: 1, ...everything except id and name}`, 2-space indent (34-37). Id and name come from the folder name (parse 50-52). Required on parse: JSON object with non-empty `uid` (else ignored); defaults `version` 1, `tags` {}, `settings` {conditions: []}, `createdAt` 0, `modifiedAt` = createdAt (43-72). Fields (AssetService.ts:180-201): `uid`, `version`, `publisherId?`, `author?`, `releasedAt?`, `coverPath?`, `description?`, `tags: Record<id, {id, name, group?, color?, icon?}>`, `settings`, `createdAt`, `modifiedAt`. Unknown fields kept. `uid` must be a fresh UUID: a duplicate uid is read as a folder copy and re-uid'd after `COPY_SETTLE_MS = 60_000` (libraryState.ts:42; mergeCollections.ts:9,24-31).

`CollectionSettings` (types/collectionSettingsTypes.ts:75-141): req `conditions: ConditionDefinition[]` (`{id, name, color, icon?, valued?, effect?}`); optional `gridDefaults`, `defaultWidgets`, `widgets`, `systemPresetId`, `dice`, `diceSetId`, `initiative`, `senses`, `lightPresets`, `defaultTokenVision`, `statblockRoles`, `statblockRoleFolders`, `itemRarities`, `resources: ResourceDefinition[]` (`{key, name, field, direction:'drains'|'fills'|'static', color, defeatedWhenSpent?, visibleToPlayers, slot?}`, resourceTypes.ts:12-29; parse resources/resourceDefinitions.ts:81-109, max 6), `customCreatureFilters`, `hiddenCreatureFilters`, `lootBases`, `lootCurrency`, `randomTables`. No central settings validator; each reader validates its own field. Changes reach open scenes via the `atlas-vtt:collection-settings-changed` event (AssetService.ts:1505-1511). Condition ids used by tokens (`conditions`) must exist here.

### 9.5 `library.json` (collectionFile.ts:8-13,83-96)

`{format: 1, defaultCollectionId?, vaultId?, starterTokensAdded?}`. Other keys are dropped on rewrite. Do not create it unless the vault is already migrated: its presence disables the legacy migration and legacy visible index (libraryPaths.ts:13).

### 9.6 System presets (`atlas-vtt/system-presets/<Name>.json`)

Not `atlasRecord`; record-folder mechanism: `JSON.stringify({format, ...record}, null, 2) + "\n"`, `format` leads, `PRESET_FILE_FORMAT = 1` (presetFiles.ts:28; recordFiles/recordLayout.ts:34-38). Shape `SystemPreset {id, name, builtIn:false, rules: SystemRules}` (types/systemPresetTypes.ts:18-76). `rules` req: `gridDefaults`, `conditions`; optional `widgets, defaultWidgets, dice, diceSetId, initiative, resources, defaultTokenVision, senses, lightPresets, statblockRoles, itemRarities`.
- Identity is `id`, not path. New ids `crypto.randomUUID()` (SystemPresetService.ts:37); ids starting `builtin:` are ignored in files (recordFolder.ts:53-55). Built-ins live in code: `builtin:daggerheart, dnd5e, cairn, coc7e, cyberpunkred, drawsteel, ose, pathfinder2e, shadowdark` (gameSystems/builtInPresets.ts:18-28; presetHelpers.ts:8-10). Dice sets: `builtin:d20`, `builtin:d20-roll-under`, `builtin:d100-roll-under`, `builtin:d10-exploding`, `builtin:power-roll` (builtInDiceSets.ts:18-22).
- Duplicate id: lower path wins, the other is a conflict copy and ignored (recordFiles/RecordFiles.ts:57-81).
- Validation (lenient, drops bad entries): `parseUserPreset` (gameSystems/presetValidation.ts:186-191) needs object, non-blank `id`/`name`, non-`builtin:` id, `rules` accepted by `parseSystemRules` (145-183: requires parsable `gridDefaults` and an array `conditions`; omitted `resources` synthesises an HP resource, 157-160). Entry points: `parseUserPresets` (194-203), `readPresetText` (presetFiles.ts:49), `SystemPresetService.list()` (SystemPresetService.ts:22-25).
- `collection.settings.systemPresetId` is a back-reference by id; deleting or renaming a preset file does not change collections.

### 9.7 Parsing and validation entry points (pure, no Obsidian runtime)

`parseSceneFile(content)` (MP:128), `migrateMapFile(state)` (MP:363), `sceneFromFile(state)` (RFF:140), `sceneToFile(state)` (RFF:151), `parseRecordFile(text, path)` and `serializeRecord(asset)` (recordFile.ts:141,75), `parseCollectionFile(text, folderId)` and `parseLibraryFile(text)` (collectionFile.ts:43,88), `parseUserPreset`/`parseSystemRules` (presetValidation.ts:186,145), `isRecordFileCandidate`/`isLibraryFile` (libraryPaths.ts:36,46), `reconcileIndex(metadata, listing)` (vault-sync/reconcileIndex.ts:64). Most faithful scene load: `createViewAtlasStore(app, id)` with `createInMemoryApp({files})`, then `setPersistenceEnabled(false); setMapPath(path); await store.persist.rehydrate()` (tests/unit/statblockResourcePersistence.test.ts:9-12). Run unit tests with `npx vitest run --project unit`. No `.atlasmap` or record fixture files exist in the repo; fixtures are inline in tests.

### 9.8 Asset index (device-local cache)

`atlas-vtt/.atlas-data/assets-metadata.json` (`getDataFilePath`, utils/dataFileMigration.ts:273-292): `AssetMetadata {collections, assets, version, vaultId?, ...}` plus `libraryState` stamps (AssetService.ts:203-213,244). It is a cache of the visible files, rebuilt from the vault if missing or unreadable (AssetService.ts:394-406,443-454). Files win over the cache (CLAUDE.md "Vault files and the asset index"). Recognition does not need the index: library files are read first, then reconciled (AssetService.ts:870-893; mergeLibraryChanges.ts:28-48,101-106). Change detection is by (size, mtime) then hash (libraryReader.ts:67-72); an edit with identical size and mtime is not re-read (edge case **UNVERIFIED**). After migration the file wins on read; on a device not yet migrated the cache wins if its `modifiedAt >=` the file's (mergeLibraryChanges.ts:89). Always bump `modifiedAt`.

---------------------------------------------------------------------------

## 10. Risks for external editing (prioritised)

**R1. Atlas has the scene open and overwrites it.** No locking or merge. Atlas rewrites the whole file (compact JSON, `partialize` key order) 500 ms after any persisted change (`SAVE_DELAY_MS`, LS/sceneFileWriter.ts:12,44-52), via `vault.process` (atomic per file, last write wins; sceneFileWriter.ts:93-112). An external edit to an open scene is lost on its next change. Whether Atlas re-reads on `modify`: **UNVERIFIED**. Edit only closed scenes; also do not edit within the debounce window after closing (`flush()` waits up to 5 s, sceneFileWriter.ts, `STALLED_SAVE_MS`).

**R2. `objects.audios` is never back-filled.** `objects` is replaced wholesale by merge (SF:1475-1488); `getItem` back-fills only `walls` and `lights` (MP:213-218). Confirmed unguarded accesses: `addAudio` (SF:1254), `deleteMapObject` (SF:882), `AudioRenderer.ts:88,148`, `SpatialAudioEngine.ts:118`. Atlas's own `newSceneFile` omits `walls/lights/audios` (LS/newSceneFile.ts:28-60), so the initial state is overwritten there; whether another path repairs it was not found. Always write all eight maps.

**R3. Version semantics.** `ATLAS_VERSION = 4` (MP:28) and never bumps. The store's persist `version` is 4 (SF:1439) and no `migrate` is configured; zustand discards a state whose envelope version is a number other than the store's (node_modules/zustand/middleware.js:360-376). Atlas prevents that on its own read path: `getItem` raises a lower `state.version` and envelope `version` to 4 in place before zustand sees them (MP:226-233), and a missing envelope version skips the check. So lower or missing versions load; > 4 in either place is refused by `parseSceneFile`, not backed up, left untouched (MP:136-137; tests/unit/mapPersistence.unreadableData.test.ts:47-56). Older Atlas builds load higher versions as empty and overwrite them (CLAUDE.md "Token resources"). Write 4 in both places; a reader that bypasses `getItem` must apply the same bump.

**R4. Token resources and tokenSettings shape.** Use file fields; invalid values are dropped silently (RFF:32-61); `tokenSettings` replaces defaults wholesale; missing `showStressBars` hides stress (RFF:94-108). Resource keys must match the collection's definitions.

**R5. Lazy, silent validation.** Invalid walls/lights are ignored but kept; fog is discarded entirely in the `MapLoader` view if the first value lacks `kind: 'fog'` (MP:318-340); `statuses`, `app://` paths, grid legacy keys are normalised only in `migrateMapFile`, not the live store, so write the modern shape (MP:288-358).

**R6. Fields Atlas rewrites on load or first save.** Unknown top-level `state` keys dropped; `resources` -> file fields; `mapPath` replaced; `lighting` merged with defaults and invalid colours deleted; `lootRoller` sanitised; invalid `exploredMask` -> null; running timers paused; collection widgets stripped; initiative vitals regenerated. Unknown keys inside entities, `grid`, `tokenSettings`, `initiative` are preserved. Exactly when the first write happens after opening: **UNVERIFIED**; expect a rewrite soon after opening (`fillMissingResources`, `takePlacedCombatants`, grid `autoDetect` and timer pausing change persisted slices; their full list is **UNVERIFIED**).

**R7. Migration side effects.** Widget migration rewrites the file compact (MP:200-211). Parse failures `invalidJson`/`structure` copy the file to `<path>.<Date.now()>.bak` and abort the load (LS/sceneFileProblems.ts:29-39); `newer` and `unreadable` do not back up. A failed load saves nothing over the file.

**R8. Ids.** Unique per scene across kinds; key === `id`; stable (initiative `tokenId`, preview `anchorId`). Library records: `atlasRecord.id` is global across the vault; duplicates resolved by file named `<id>.json`, then newest `modifiedAt`, then lowest path; copies get `<id>-copy-<hash(path)>` (library/recordHolders.ts:34-60).

**R9. Coordinates and units.** World px from the image top-left, y down; centre-based tokens; game units for light/vision but px for audio; degrees; STRETCHED world when `mapStretch` is set (section 4).

**R10. Paths.** Vault-relative, forward slash, exact-string matching (e.g. `asset.imagePath === tokenImagePath`, TokenStatblockLinkService.ts:252-256). Rename through Obsidian; the rewriter skips several fields (section 8). Absolute paths contain the collection folder name, so they break on collection rename (recordHolders.ts:51-57).

**R11. The folder decides the collection.** A scene moved between collection folders changes collection. A record whose `atlasRecord.collection` differs from its folder is treated as a copy or move (recordHolders.ts:19,34-44; mergeLibraryChanges.ts:51-75). Write `atlasRecord.collection` = the folder's collection id. Do not leave non-token images in `tokens/` (adopted as tokens).

**R12. Library normalisation churn.** After the first library read, Atlas rewrites any record file whose bytes differ from its canonical output (libraryWriter.ts:76-97; AssetService.ts:435). Content is preserved except extra top-level keys in token/note files and in `library.json`. This can cause sync churn if another device edits too.

**R13. Format gating.** `format > 1` on a record/collection/library file freezes it against Atlas rewrites. Presets keep a larger number on rewrite (recordLayout.ts:35-36). Do not set `format` above 1.

**R14. Delete + recreate and atomic saves.** An external tool that saves via temp-file rename can look like delete then create. Tokens, maps, scenes with a known record survive; encounters/players/characters/statblocks drop only when the deletion was seen (assetRelink.ts:53-65; libraryReader.ts:76-81). Prefer in-place overwrite.

**R15. Caches.** The asset index, thumbnails and snapshots are caches independent of the scene file; never hand-edit the index; a stale thumbnail after an external edit is harmless. `.atlas-data/` is never to be touched.

---------------------------------------------------------------------------

## 11. Machine-readable schema, example, tests

- `docs/fork/atlasmap.schema.json`: JSON Schema generated from the TypeScript types in `docs/fork/schema/atlasmapFile.ts`, which mirrors `src/app/resources/resourceFileFormat.ts` (the on-disk token/tokenSettings/initiative shapes) plus the persisted view types. The schema is the authority for field names and types; this document is the authority for semantics, units, defaults and risks.
- `docs/fork/examples/minimal.atlasmap`: a minimal valid scene (envelope, both versions 4, all eight object maps).
- `tests/unit/fork/atlasmapFormat.test.ts`: validates the example against the real parsing code and the schema.
- Source-of-truth code: `MP:128-139` (`parseSceneFile`), `MP:169-242` (`getItem`), `RFF` (disk shape), `SF:1445-1488` (`partialize` and `merge`).
