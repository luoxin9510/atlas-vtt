Architecture overview of Atlas VTT as of upstream 0.9.1 (commit 5499fd87), written for this fork.

Paths are relative to the repo root. Line numbers refer to that commit. Anything marked "unverified" was not read in code.

## 1. Plugin entry (`main.ts`, 308 lines)

`AtlasVTTPlugin extends Plugin` (`main.ts:90`). It holds shared state that every view reads: `settingsService`, `widgetSyncService` (lazy), `globalAssetManager`, plus private `imageDisplayService`, `changelogService`, `onlinePlay`.

`onload` (`main.ts:120-235`), in order:
1. Error log + `IssueReporter` + `report-issue` command (`:122-125`).
2. Capture `existingInstallation = vault.adapter.exists('atlas-vtt')` *before* anything can create the folder (`:128`). Then `storageReady` = `initializeAtlasStorage` + `runStartupMigration` (`:129-132`).
3. Fire-and-forget vault-file singletons: `SystemPresetFiles`, `CampaignFiles`, `PlayedRules`, `QuestIndex`, `CampaignPlayers`, `CampaignBooks`, `DiceSetFiles` (`:134-154`), and `registerPartySync`.
4. `settingsReady` (preset load + `migrateSettingsToPluginData`), then `new SettingsService(app, settingsReady, this)` (`:156-162`).
5. Before the first `await`: `registerVaultSync`, `registerDiceStageRelease`, `registerAccentColorSync`, **`registerAtlasViews()`** (so Obsidian can restore persisted Atlas tabs), the statblock fence, note-writer flush, template-body following, hosted-dialog release (`:166-179`).
6. `await storageReady; await settingsService.initialize()` (`:181-182`). After each later await the code checks `this.unloaded` (`:183`, `:187`), because Obsidian may unload mid-`onload`.
7. Dice look sync, statblock panels, `ChangelogService`, `registerUpdateWatch`, `GlobalAssetManagerService`, `ImageDisplayService`, `registerOnlinePlay` (`:184-201`).
8. Setting tab, header editor suggest, `registerAtlasLinks`, leaf sync, return-to-Atlas-on-close, player-window reload cleanup, `registerCommands`, statblock file/initiative menus (`:202-223`).
9. `workspace.onLayoutReady` (`:225-234`): swatch icons, image context menu, status bar, changelog popup, and three background migrations (starter tokens, token bar carry-over, legacy snapshots).

`onunload` (`:255-283`) sets `unloaded`, flushes settings, then calls `release(app)` on every singleton, destroys the widget sync, image display, `PlayerWindowService`, asset manager, tile decoder / map image services, image processing and the spectral engine. `onExternalSettingsChange` (`:251`) reloads settings when `data.json` changes on disk (sync).

## 2. Registrations

**Views and extensions** (`registerAtlasViews`, `main.ts:298-307`):

| Constant | Value | Class | Defined in |
| --- | --- | --- | --- |
| `ATLAS_VIEW_TYPE` | `atlas-vtt` | `AtlasView extends FileView` | `src/app/atlasViewType.ts:9`, `src/app/atlas-view.ts` |
| `LOCAL_PLAYER_VIEW_TYPE` | `atlas-vtt-local-player` | `LocalPlayerView` | `src/app/local-player-view.ts:9` |
| `DASHBOARD_VIEW_TYPE` | `atlas-vtt-dashboard` | `DashboardView` (own React root) | `src/app/dashboard-view.tsx:13` |
| `TEMPLATE_EDITOR_VIEW_TYPE` | `atlas-statblock-template` | `TemplateEditorView` | `src/app/statblocks/editor/templateEditorState.ts:6` |
| `LOOT_QUERY_VIEW` | `atlas-loot` | Bases view via `registerLootQueryView` | `src/app/loot/lootBaseQuery.ts:8` |

- Extensions: `atlasmap` -> `ATLAS_VIEW_TYPE` (`main.ts:299`, constant `EXTENSION_ATLASMAP` in `src/app/utils/sceneFiles.ts:2`); `atlastemplate` -> template editor (`:306`, `src/app/statblocks/library/templateFiles.ts:12`).
- Note: `src/app/online/gm/atlasView.ts:8-10` redeclares the two view-type strings (a boundary-friendly duplicate; not checked further).

**Commands** (all via `plugin.addCommand`):
- `src/app/plugin/registerCommands.ts`: `display-image-on-player-view`, `dismiss-image-from-player-view`, `send-map-to-player-view`, `show-map-in-player-window`, `open-player-window`, `open-dashboard`, `open-scene-browser`, `toggle-initiative-tracker`, `toggle-loot-roller`, `toggle-dice-log`, `clean-up-missing-assets`, `import-statblock-tokens`, `create-token-from-statblock`, `new-statblock-template`.
- Elsewhere: `report-issue` (`main.ts:125`), `view-changelog` (`main.ts:194`), `insert-atlas-link` (`src/app/links/registerAtlasLinks.ts`, editor command). Online commands come from `ONLINE_COMMANDS` (not described here).
- **Ribbon**: exactly one, `addRibbonIcon('monitor', ...)` at `registerCommands.ts:82`.
- **Settings tab**: `AtlasSettingTab` (`src/app/settings/AtlasSettingTab.ts:5`), added at `main.ts:202`. It is assembled from "sections" (navigation, dice, lighting, map image cache, hotkeys, onboarding, changelog, online play, support).
- **Markdown / embeds**: statblock code fence (`registerStatblockFence`), per-note statblock panels (`registerNoteStatblockPanels`), a Bases "give" button hook (`registerBaseGiveButtons`), `HeaderAutocompleteSuggest` (`registerEditorSuggest`, `main.ts:213`), and scene/encounter embeds through the undocumented `app.embedRegistry` (see 6).
- **Protocol handlers**: none. `grep registerObsidianProtocolHandler` over `src` and `main.ts` finds nothing.

## 3. React / Pixi / three.js layering

```
Obsidian leaf ──> AtlasView (FileView)                     src/app/atlas-view.ts
   │ new ServiceManager(app, store, plugin, viewId)        :100   (one per view)
   │ onOpen (:221): rendererService.init(containerEl)
   │            └ PixiAppManager (new Application, canvas) src/app/pixi/PixiAppManager.ts
   │            └ PixiRendererOrchestrator (layers/tools)  src/app/services/RendererService.ts:49-53
   └ uiOverlay.mount(containerEl, view, pixiApp)           :252
        └ createUILayers -> reactRoot div
        └ mountUI: createRoot(...).render(                 src/app/react/index.ts
             <ViewStoreProvider store><UIRoot app view pixiApp/></...>)

   zustand store (per view)  <──────────────┐
      React: useStore via ViewStoreContext   │  Pixi renderers subscribe
      (src/app/react/ViewStoreContext.tsx)   │  (store-driven, update in place)
```

- **Mount**: `AtlasView.onOpen` first creates Pixi, then mounts React *over* it. The canvas is appended to the view container (`PixiAppManager.ts:73`); React renders into a separate overlay layer (`UIOverlay`, `createUILayers`). `mountUI` renders without `StrictMode` (comment in `src/app/react/index.ts`). `DashboardView` is the exception: it calls `createRoot` itself (`dashboard-view.tsx:44`). Other `createRoot` users are modals/popups (`ChangelogModal.tsx`, `EditTokenModal.tsx`, `AudioConfigPanel.tsx`, `baseGiveButtons.tsx`).
- **Pixi ownership**: `PixiAppManager` constructs `new Application()` (`:30`) and `init`s it with fallback `['webgl','canvas']` renderers (`:112-120`). `RendererService` (per view) owns the manager and the `PixiRendererOrchestrator`. Pixi is **v8** (`pixi.js ^8.22.0`) with `pixi-viewport`, `pixi-filters`. `RenderScheduler` (`src/app/pixi/RenderScheduler.ts`) renders on change only, not every tick.
- **Store**: `createViewAtlasStore(app, viewId, plugin, isPlayerView)` (`src/app/storeFactory.ts:366`). Middleware stack (from outer): `withHistory` (own undo/redo, `src/app/stores/history.ts`) -> `subscribeWithSelector` -> `persist` -> `immer` (`:452-462`, zustand + Immer 11). Persistence goes through `createAtlasStorage` (`src/app/services/MapPersistence.ts`) into the scene file, debounced, and only when `persistenceEnabled && mapLoaded`. Slices live in `src/app/stores/` (`uiSlice`, `mapObjectsSlice`, `initiativeSlice`, `lootRollerSlice`, ...). Each view has its own store; `tabMetaStore` holds scene-tab metadata.
- **three.js**: used only by 3D dice, `src/app/dice3d/` (`DiceRenderer`, `DiceGpu`, `dieMesh`, `stageShadow`, ...), displayed by `src/app/react/components/dice/DiceRollDisplay.tsx`. It has its own WebGL context(s), separate from Pixi. Upstream CLAUDE.md says one `DiceGpu` context per document draws all dice stages.

## 4. Services

Per **app/plugin** lifetime (singletons keyed by `app`, released in `onunload`):
- `SettingsService` (`src/app/services/SettingsService.ts:40`, `forApp(app)`): GM settings in `data.json` via `loadData/saveData` (`:102`, `:122`). Created in `onload`; views read `plugin.settingsService`.
- `AssetService` (`src/app/services/AssetService.ts:249`, `getInstance(app)` `:273`): the asset index (tokens, maps, scenes, encounters, collections); vault reconciliation lives in `src/app/services/vault-sync/`.
- Library layer `src/app/services/library/` (`libraryWriter.ts`, `libraryReader.ts`, `mergeLibraryChanges.ts`, `LibrarySync.ts`, `libraryPaths.ts`): writes/reads record files so the library syncs.
- `GlobalAssetManagerService`, `ImageDisplayService`, `ChangelogService`, `PlayerWindowService` (`getInstance()`), `FileReferenceService`, `WidgetSyncService` (created by the first view's `ServiceManager`, `plugin.widgetSyncService ??=`, `ServiceManager.ts:88`).
- Vault-file singletons opened in `onload`: `SystemPresetFiles`, `CampaignFiles`, `CampaignPlayers`, `CampaignBooks`, `PlayedRules`, `QuestIndex`, `DiceSetFiles`, `CreatureIndex`, `TemplateLibrary`, `LootHistoryStore`, `TileDecoderClient`, `MapImageService`.

Per **view** lifetime: `ServiceManager` (`src/app/services/ServiceManager.ts:29`, constructor `:47-100`) creates and exposes `RendererService`, `LayerGraph`, `UIOverlay`, `MapService`, `ToolController`, `GridManager`, `NotePreviewUIManager`, `SoundEffectService`, `DiceToastObserver`, `MapThumbnailService`, `SceneThumbnailUpdater`, and an `EventEmitter` bus (view-local events like `dice-rolled`, `ui-mounted`). It reuses the plugin's `SettingsService` and the `AssetService` singleton.

## 5. Data in the vault

Layout (constants in `src/app/services/assetPaths.ts:1-4`, `library/libraryPaths.ts`, `vault-sync/assetFiles.ts:31`):

```
atlas-vtt/
  library.json                 defaultCollectionId, vaultId, starterTokensAdded
  assets/                      GLOBAL_ASSETS_DIR (shared map images)
  system-presets/<..>.json     user game-system presets (presetFiles.ts:25)
  collections/<id>/
    collection.json            settings, tags, release (id/name = folder name)
    install.json               last import/export baseline
    maps|scenes|encounters|players|characters|statblocks/*.json
    tokens/<id>.json  notes/<id>.json   (record files; art/notes live beside)
    snapshots/<scene id>/  loot-history/<device id>.json   (Atlas-owned, not assets)
    *.atlasmap                 scene files
  .atlas-data/                 device-local cache: assets-metadata.json, import backups
```

- Three kinds of data (upstream CLAUDE.md, "Vault files and the asset index"): content in vault files; GM preferences in the plugin `data.json` (`SettingsService`); per-device facts in `app.saveLocalStorage` (device id, crash marker, migration flags; e.g. `plugin/deviceId.ts`, `plugin/settingsMigration.ts`).
- The asset index `atlas-vtt/.atlas-data/assets-metadata.json` is only a cache of the record files. The older visible `atlas-vtt/assets-metadata.json` is read only while no `library.json` exists (`libraryPaths.ts:9`).
- Migration helpers: `src/app/plugin/startupMigration.ts` (moves into `.atlas-data`, settings to plugin data), `src/app/utils/dataFileMigration.ts`.
- `.atlasmap` scenes: JSON written by `SceneFileWriter` (`src/app/services/sceneFileWriter.ts`) and read through `createAtlasStorage` (`MapPersistence.ts`, `ATLAS_VERSION` stays 4). Path helpers: `src/app/utils/sceneFiles.ts`. The exact format is documented in a later phase (`docs/fork/atlasmap-format.md`).

## 6. Where the Obsidian API is touched

Counts: 541 files under `src`, `main.ts` and `services` import from `'obsidian'` (`grep -rlE "from 'obsidian'"`); 536 are non-test, 5 are tests. Largest clusters by directory: `services` 70, `plugin` 29, `react/components/dashboard` 17, `online/gm` 17, `statblocks/editor/*`, `services/collectionBundle` 15.

- **Vault I/O**: `vault.adapter` / `vault.read*` / `modify` in about 103 non-test files. Main: `AssetService`, `services/library/*`, `services/vault-sync/*`, `MapPersistence`, `sceneFileWriter`, `plugin/vaultSync.ts` (vault events), `FileReferenceService`, `fileManager.renameFile` for moves (`assetTransfer`).
- **Workspace / views**: `FileView`/`ItemView`, `registerView`, `registerExtensions`, leaf handling: `atlas-view.ts`, `local-player-view.ts`, `plugin/atlasLeaves.ts`, `plugin/returnToAtlasOnClose.ts`, `PlayerWindowService`, `detachedNoteLeaf.ts`, `utils/activeLeafGuard.ts`, popout support under `pixi/popout/`.
- **Metadata cache**: about 36 non-test files touch `metadataCache` (e.g. `campaigns/` via `QuestIndex`, `statblocks/notes/statblockSource.ts`, `randomTables/TableNoteReader.ts`, `tools/pinNoteSearch.ts`, `plugin/StatblockTokenSync.ts`).
- **UI / modals**: about 8 `Modal`-family classes and 68 files using `Notice`. Atlas wraps most of this (`src/app/ui/notice.ts`).
- **Undocumented internals**: typed in `src/app/plugin/types/obsidianInternals.d.ts` (module augmentation of `obsidian`): `App.appId`, `openWithDefaultApp`, `showInFolder`, `plugins`, `customCss`, `embedRegistry` (`registerExtension` / `unregisterExtension`), `FileManager.promptForFileRename`, file-explorer view. `registerAtlasLinks.ts:18-22` registers `atlasmap` and `json` (encounters only) embeds there and unregisters on unload. `SnapshotLinkSuggest.ts:104` reorders `workspace.editorSuggest.suggests`. Third-party plugin access: Fantasy Statblocks via `services/FantasyStatblocksService.ts`.
- `scripts/boundaries.mjs` + `scripts/check-boundaries.mjs` (`npm run check:boundaries`) separate a "shared" set of dirs (types, lighting, fog, vision, grid, gameSystems, dice3d, online protocol, ...) from plugin-only code (`services/`, `plugin/`, `settings/`, store/view files, `PLUGIN_ONLY_SPECIFIER` at `:170`); shared code may not import `obsidian` (`scripts/boundaries/no-obsidian.d.ts`).

## 7. Online, build, tests

- **Atlas Online / networking**: `src/app/online/` (`gm/`, `protocol/`, `marks/`, `movement/`, `tableLog/`); entry glue is `src/app/plugin/onlinePlay.ts` (gated by an experimental switch, `OnlineFeature` in `online/gm/`). `services/issue-reporter/` (Python `server.py`/`reporter.py`) is a separate server-side helper for issue reports. Not described further (fork rule: do not touch).
- **Build**: `vite.config.mts`. Library build, entry `main.ts`, single CJS `dist/main.js` with inlined dynamic imports (`:123-157`); CSS is emitted as `styles.css`. Externals: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, Node builtins. Plugins: `changelog()` (`vite/changelog.mts`), `desktopDependencies()` (`vite/desktop-dependencies.mts`, patches React DOM and JSZip), `@vitejs/plugin-react`, and an inline `copyFilesPlugin` active when `COPY_ON_CHANGE=true`. Defines `__ATLAS_RELEASE_BUILD__` and `process.env.NODE_ENV`. Scripts: `dev` = `vite build --watch` with copy; `build` runs `postbuild` = `scripts/copy-plugin.js`.
- **Copy targets**: `scripts/worktree-targets.js` `getPluginTargetDirs`: (1) nearest ancestor vault of the project (folder containing `.obsidian`), (2) `<main worktree>/test-vault`, (3) every vault in `ATLAS_DEV_VAULTS` (split by `path.delimiter`). Target is `<vault>/.obsidian/plugins/atlas-vtt`. It filters out targets whose vault root does not already exist. It also writes a `.hotreload` marker for the Hot Reload plugin. Both `vite.config.mts` and `scripts/copy-plugin.js:13` use it. The main worktree is found via `git worktree list`, branch `refs/heads/main`.
- **Tests**: `vitest.config.mts`, two projects. `unit`: node env, threads pool, `globals`, setup files `tests/setup/obsidianDom.ts` and `domHost.ts`, excludes `*.gpu.test.ts`; a DOM test opts in with `// @vitest-environment jsdom`. `gpu`: real Chromium via Playwright (headless), includes `**/*.gpu.test.ts`, 600 s timeout. The `obsidian` module is aliased to `tests/mocks/obsidian.ts`. Scripts: `npm test` (`--project unit`), `npm run test:gpu`. Other test dirs: `tests/integration`, `tests/oracles`, `tests/unit`, plus tests next to source (`__tests__`). Other gates: `npm run lint` (eslint + obsidianmd), `npm run check:boundaries`, `npm run preflight`.

## Verified follow-ups and open points

- Base classes: `AtlasView extends FileView` (`atlas-view.ts:58`), `LocalPlayerView extends ItemView` (`local-player-view.ts:43`), `TemplateEditorView extends FileView` (`statblocks/editor/TemplateEditorView.ts:41`).
- `src/app/online/gm/atlasView.ts:8-10` repeats `'atlas-vtt'` and `'atlas-vtt-local-player'` verbatim; a test holds them to the real constants (comment at `:9`).
- Not explored yet: the `.atlasmap` content structure (phase 3), the player-window rendering path, tools/controllers.
