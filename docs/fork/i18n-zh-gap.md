# zh localization gap report

Snapshot of upstream 0.9.1 (`5499fd87`), taken before any translation in this
fork. Terms and style for the translations are in `zh-glossary.md`.

## How the i18n layer works

- `src/app/i18n/types.ts`: `MessageKey` is `keyof typeof en`, so English
  defines the key set. A `Translation` is `Partial<Record<MessageKey, Message>>`;
  a `Message` is a string or a plural object `{ other, one?, few?, many?, ... }`
  (`Intl.PluralRules` categories).
- `src/app/i18n/languages.ts`: `TRANSLATIONS = { en, ru, zh }`, keyed by
  Obsidian language codes. Only the plugin bootstrap imports it.
- `src/app/i18n/index.ts`: `setLocale` resolves the code (exact match, else the
  base language, else `en`; so `zh-TW` and `zh-CN` both get `zh`). `t(key, values)`
  falls back **per key**: a key missing from the active translation renders the
  English message with English plural rules. `formatMessage` picks the plural
  form by `count` (falling back to `other`) and replaces `{name}` placeholders,
  formatting numbers for the active locale; an unknown placeholder stays as is.
- Each language is a folder of module files named by the key's first segment
  (`palette.moveTool` lives in `palette.ts`), spread into the folder's `index.ts`.
- `tests/unit/i18n.test.ts` checks that translations hold only keys English has
  and keep every English placeholder.

Consequence: a missing zh key is not an error and not a type error. It shows
English inside an otherwise Chinese UI.

## Missing keys

English holds **2435** keys in 93 module files. Chinese lacks **892** of them (36.6%): 599 in 12 module files that do not exist in `zh/`, and 293 inside 26 existing files. Of the missing keys, 204 carry `{placeholders}` and 34 are plural messages. No zh file holds a key English lacks, and every existing zh file is spread into `zh/index.ts`.

### Module files missing from `locales/zh/`

Each needs a new file exporting a `Translation` and an import plus spread in `zh/index.ts`.

| File | Keys |
| --- | ---: |
| `campaign.ts` | 40 |
| `diceLab.ts` | 112 |
| `diceRoll.ts` | 16 |
| `diceSettings.ts` | 32 |
| `initRules.ts` | 27 |
| `quest.ts` | 19 |
| `recoveryEditor.ts` | 73 |
| `rest.ts` | 37 |
| `senses.ts` | 67 |
| `tables.ts` | 111 |
| `toolbarEdit.ts` | 51 |
| `vaultImages.ts` | 14 |

### Keys missing inside existing files

| File | Missing | Keys |
| --- | ---: | --- |
| `initiative.ts` | 84 | `abilityScore`, `actNow`, `actThisRound`, `autoSort`, `autoSortHint`, `abilityScoreHint`, `clear`, `clearBody`, `clearTitle`, `collapse`, `conditions`, `defeated` … (+72) |
| `resource.ts` | 55 | `changeSelection`, `changeSelectionEntry`, `changeSelectionMenu`, `changeAmount`, `changePlaceholder`, `maxShort`, `resetAll`, `tab.hint`, `tab.sockets`, `tab.nameplate`, `tab.alwaysShown`, `tab.onHover` … (+43) |
| `encounter.ts` | 19 | `builder.title`, `builder.editTitle`, `builder.name`, `builder.showStatblock`, `builder.moreCreatures`, `builder.search`, `builder.count`, `builder.shown`, `builder.add`, `builder.addNamed`, `builder.fewer`, `builder.more` … (+7) |
| `statblock.ts` | 19 | `addToNextRoll`, `addsToRolls`, `counterAdd`, `counterLeft`, `counterMoveDown`, `counterMoveUp`, `counterRegain`, `counterRegainAll`, `counterRemove`, `counterRow`, `counterRows`, `counterUses` … (+7) |
| `csm.ts` | 16 | `playedCampaign`, `playedCampaignEdit`, `conditions.column`, `conditions.effect`, `conditions.effectOf`, `conditions.effectOfThis`, `conditions.effect.blinded`, `conditions.effect.invisible`, `conditions.effect.airborne`, `conditions.effect.undetected`, `conditions.effectsHint`, `filters.templateFilters` … (+4) |
| `dice.ts` | 15 | `formulaError.depth`, `formulaError.modifier`, `formulaError.total`, `advantage`, `disadvantage`, `normal`, `roll`, `rollWithAdvantage`, `rollWithDisadvantage`, `shiftClick`, `altClick`, `optionClick` … (+3) |
| `grid.ts` | 11 | `detectOnNewScenes`, `detectOnNewScenesHint`, `distancePerCell`, `distancePerCellIn`, `distanceFromCollection`, `distanceFromCampaign`, `distanceFromGrid`, `unit`, `unitOfCampaign`, `unitOfCollection`, `unitOfScene` |
| `loot.ts` | 11 | `give.all`, `give.copies`, `give.done`, `give.doneAll`, `give.failed`, `give.failedAll`, `give.fewer`, `give.label`, `give.more`, `give.noCharacter`, `give.quantity` |
| `align.ts` | 10 | `checking`, `cornerFirst`, `cornerNext`, `find`, `freehandHint`, `hexCornerFirst`, `hexCornerNext`, `measureCount`, `measureMore`, `orByHand` |
| `am.ts` | 10 | `menu.editEncounter`, `menu.addToInitiative`, `menu.addTokensToInitiative`, `menu.startFight`, `menu.encounterBeside`, `besidePartial`, `beside`, `header.createEncounter`, `tab.party`, `empty.partyHint` |
| `settings.ts` | 10 | `updates.available`, `updates.checkForUpdates`, `updates.checkForUpdatesDesc`, `updates.checkNow`, `updates.checking`, `updates.notice`, `updates.noticeTitle`, `updates.upToDate`, `updates.update`, `updates.whatsNew` |
| `filters.ts` | 7 | `template`, `searchOptions`, `noOptionMatch`, `keyword.template`, `keyword.text`, `text`, `templateFields` |
| `dashboard.ts` | 5 | `allCreatures`, `inThisFight`, `statblockScope`, `begin`, `resume` |
| `atlasLinks.ts` | 3 | `more`, `startFight`, `addBeside` |
| `playerInit.ts` | 3 | `conditions`, `defeated`, `delayed` |
| `token.ts` | 3 | `makePlayerCharacter`, `noLongerPlayerCharacter`, `playerCharacterFailed` |
| `bundle.ts` | 2 | `switchedNotes`, `group.templates` |
| `tokens.ts` | 2 | `showResourceBars`, `showResourceWheels` |
| `creator.ts` | 1 | `statblockNotes` |
| `editToken.ts` | 1 | `token` |
| `issue.ts` | 1 | `area.online` |
| `link.ts` | 1 | `moved` |
| `lpv.ts` | 1 | `showCursors` |
| `pinMenu.ts` | 1 | `readable` |
| `sbImport.ts` | 1 | `noneFoundInVault` |
| `toolbar.ts` | 1 | `optionsOf` |

## Hard-coded user-facing strings that bypass `t()`

Found with a heuristic `rg` scan of `main.ts` and `src/` (excluding i18n, tests, game-system presets, issue-report text and log messages, which upstream keeps English by rule). Not refactored in this phase. Rows were spot-checked; a few may be identifiers that look like prose.

The largest group is the experimental statblock template editor (`src/app/statblocks/editor/`), which is not wired to `t()` at all. Atlas Online code (`src/app/online/`) is counted but out of scope for this fork.

Total hits after filtering: 573 (non-online 442: prop 199, jsx 178, notice 30, builder 19, command 16; online 131, do not touch: builder 68, jsx 30, prop 22, notice 11).

Table lists the 150 most user-visible non-online hits (notices, Obsidian builders and commands, then menu labels, then JSX text and attributes). Online rows are counted above and not listed.

| File:line | Kind | String (truncate to 60 chars) | Note |
|---|---|---|---|
| src/app/atlas-view.ts:561 | notice (showNotice) | `"${file.name}" is not an Atlas scene. To play on a map imag…` | notice |
| src/app/changelog/ChangelogModal.tsx:27 | Obsidian builder | `What’s new in Atlas` |  |
| src/app/experimental/experimentalFeatures.ts:12 | object `label` | `Statblock editor` |  |
| src/app/experimental/experimentalFeatures.ts:17 | object `label` | `Online play` |  |
| src/app/import/uvtt/runUvttImport.ts:39 | notice (showNotice) | `Importing ${file.name}…` | notice |
| src/app/import/uvtt/runUvttImport.ts:46 | notice (showNotice) | `Could not import ${file.name}. ${result.problem}` | notice |
| src/app/lighting/lightActivity.ts:32 | object `label` | `Always` |  |
| src/app/lighting/lightActivity.ts:33 | object `label` | `From dusk` |  |
| src/app/lighting/lightActivity.ts:34 | object `label` | `At night` |  |
| src/app/lighting/lightActivity.ts:41 | object `label` | `Below ${Math.round((gate ?? 0) * 100)} % light` |  |
| src/app/lighting/lightPresets.ts:19 | object `label` | `Candle` |  |
| src/app/lighting/lightPresets.ts:20 | object `label` | `Torch` |  |
| src/app/lighting/lightPresets.ts:21 | object `label` | `Lantern` |  |
| src/app/lighting/lightPresets.ts:22 | object `label` | `Magical light` |  |
| src/app/lighting/lightPresets.ts:24 | object `label` | `Darkness` |  |
| src/app/packages/components/asset-manager/CreateCollectionModal.tsx:173 | JSX text | `Sets how distances are measured and which conditions tokens…` | HTML entity in text |
| src/app/packages/components/asset-manager/collection-transfer/ContentsList.tsx:88 | JSX text | `What&rsquo;s included` | HTML entity in text |
| src/app/packages/components/asset-manager/contextMenus/assetContextMenu.ts:81 | object `label` | `Create Scene` |  |
| src/app/packages/components/asset-manager/create-collection/CustomSystemStep.tsx:70 | JSX text | `Resources` |  |
| src/app/packages/components/asset-manager/hooks/useUvttImport.ts:54 | notice (showNotice) | `${which} Atlas can import. Drop a .dd2vtt, .uvtt or .df2vtt…` | notice |
| src/app/packages/components/asset-manager/hooks/useUvttImport.ts:91 | notice (showNotice) | `"${last.name}" could not be opened. It is in the Scenes tab.` | notice |
| src/app/packages/components/asset-manager/token-creator/StatblockRoleSelect.tsx:15 | object `label` | `None` |  |
| src/app/packages/components/asset-manager/token-creator/StatblockRoleSelect.tsx:24 | JSX text | `Statblocks` |  |
| src/app/packages/components/asset-manager/utils/spawnTarget.ts:63 | notice (showNotice) | `No scene is open. Open a scene to add tokens to it.` | notice |
| src/app/packages/components/asset-manager/utils/spawnTarget.ts:76 | notice (showNotice) | `The scene is still loading. Add the tokens once it is open.` | notice |
| src/app/packages/components/toolbar/ExploredMemorySection.tsx:8 | object `label` | `Reveal` |  |
| src/app/packages/components/toolbar/ExploredMemorySection.tsx:9 | object `label` | `Forget` |  |
| src/app/packages/components/toolbar/ExploredMemorySection.tsx:13 | object `label` | `Brush` |  |
| src/app/packages/components/toolbar/ExploredMemorySection.tsx:14 | object `label` | `Lasso` |  |
| src/app/packages/components/toolbar/ExploredMemorySection.tsx:15 | object `label` | `Rectangle` |  |
| src/app/packages/components/toolbar/LightingToolGroup.tsx:24 | object `label` | `Light zones` |  |
| src/app/packages/components/toolbar/LightingToolGroup.tsx:25 | object `label` | `Explored memory` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:14 | object `label` | `Steady` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:15 | object `label` | `Torch` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:16 | object `label` | `Candle` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:17 | object `label` | `Pulse` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:18 | object `label` | `Shimmer` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:79 | JSX attr | `All` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:79 | JSX attr | `All around` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:91 | JSX text | `Flicker` |  |
| src/app/pixi/lighting/LightEmissionFields.tsx:96 | JSX text | `Outshines magical darkness` |  |
| src/app/pixi/lighting/LightPopover.tsx:112 | JSX text | `Delete` |  |
| src/app/pixi/lighting/LightPopover.tsx:127 | JSX text | `Shines` |  |
| src/app/pixi/lighting/LightPresetChips.tsx:51 | JSX text | `Kind of light` |  |
| src/app/pixi/lighting/LightZonePopover.tsx:95 | JSX text | `Delete` |  |
| src/app/pixi/lighting/SceneLightingPanel.tsx:27 | object `label` | `As the system says` |  |
| src/app/pixi/lighting/SceneLightingPanel.tsx:28 | object `label` | `Grey` |  |
| src/app/pixi/lighting/SceneLightingPanel.tsx:29 | object `label` | `In colour` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:17 | object `label` | `Candle amber` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:18 | object `label` | `Torch orange` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:19 | object `label` | `Lantern gold` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:20 | object `label` | `Warm white` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:21 | object `label` | `Arcane blue` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:22 | object `label` | `Fey green` |  |
| src/app/pixi/lighting/lightPopoverFields.tsx:23 | object `label` | `Ember red` |  |
| src/app/pixi/lighting/lightingMenus.ts:41 | object `label` | `Unlock door` |  |
| src/app/pixi/lighting/lightingMenus.ts:45 | object `label` | `Lock door` |  |
| src/app/pixi/lighting/lightingMenus.ts:90 | object `label` | `Remove door` |  |
| src/app/pixi/lighting/lightingMenus.ts:94 | object `label` | `Remove point` |  |
| src/app/pixi/lighting/lightingMenus.ts:119 | object `label` | `Blocks` |  |
| src/app/pixi/lighting/lightingMenus.ts:126 | object `label` | `Limited (see past the first)` |  |
| src/app/pixi/lighting/lightingMenus.ts:130 | object `label` | `Delete this wall` |  |
| src/app/pixi/lighting/lightingNotices.ts:10 | notice (showNotice) | `Dynamic lighting could not run on this graphics device. Atl…` | notice |
| src/app/pixi/lighting/lightingNotices.ts:15 | notice (showNotice) | `Undid an edit of the explored memory.` | notice |
| src/app/pixi/lighting/lightingNotices.ts:15 | notice (showNotice) | `Redid an edit of the explored memory.` | notice |
| src/app/pixi/lighting/lightingNotices.ts:20 | notice (showNotice) | `A map can have ${MAX_LIGHT_ZONES} light zones. Delete one t…` | notice |
| src/app/plugin/onlinePlay.ts:42 | notice (showNotice) | `Online play needs Obsidian ${SECRET_STORAGE_VERSION} or new…` | notice |
| src/app/plugin/registerCommands.ts:187 | command name | `New statblock template…` | command name (next line of addCommand) |
| src/app/react/components/CommandPalette.tsx:90 | object `title` | `Experimental Features` |  |
| src/app/react/components/CommandPalette.tsx:427 | object `label` | `Experimental features` |  |
| src/app/react/components/CommandPalette.tsx:435 | object `label` | `Dynamic lighting` |  |
| src/app/react/components/collection-settings/CreatureFiltersTab.tsx:124 | JSX text | `Other fields in this collection&apos;s statblocks` | HTML entity in text |
| src/app/react/components/collection-settings/RulesSettingsTabs.tsx:39 | object `label` | `Resources` |  |
| src/app/react/components/collection-settings/RulesSettingsTabs.tsx:41 | object `label` | `Statblocks` |  |
| src/app/react/components/collection-settings/dice-lab/DiceTray.tsx:257 | object `label` | `${edgeCaption(openEdge.side)}, ${open.name.trim() \|\|` |  |
| src/app/react/components/randomTables/RandomTablesPanel.tsx:145 | notice (showNotice) | `Copying a result` | notice |
| src/app/react/root/PanelBoundary.tsx:35 | notice (showNotice) | `Atlas VTT could not show ${this.props.name}. The rest of th…` | notice |
| src/app/services/collectionBundle/bundleContents.ts:52 | object `label` | `Images and PDFs` |  |
| src/app/services/collectionBundle/bundleContents.ts:53 | object `label` | `Loot tables` |  |
| src/app/services/collectionRecords.ts:50 | Obsidian builder | `${id} collection` |  |
| src/app/services/sceneFileWriter.ts:70 | notice (showNotice) | `Atlas VTT could not finish saving ${sceneNameOf(path)}. Its…` | notice |
| src/app/statblocks/editor/create/NewStatblockPopover.tsx:73 | JSX text | `New statblock` |  |
| src/app/statblocks/editor/create/StatblockFeedMenu.tsx:42 | object `label` | `Edit statblock` |  |
| src/app/statblocks/editor/create/TemplateChoiceModal.ts:14 | Obsidian builder | `New statblock from…` |  |
| src/app/statblocks/editor/create/createFlow.ts:79 | notice (showNotice) | `Couldn't create the statblock.` | notice |
| src/app/statblocks/editor/create/createFlow.ts:142 | notice (showNotice) | `Couldn't create the statblock.` | notice |
| src/app/statblocks/editor/create/fsStatblockActions.ts:115 | notice (showNotice) | `Couldn't change the statblock: ${problem}` | notice |
| src/app/statblocks/editor/create/fsStatblockActions.ts:127 | object `title` | `New template from this statblock` |  |
| src/app/statblocks/editor/create/fsStatblockActions.ts:174 | notice (showNotice) | `This note holds no statblock block to copy.` | notice |
| src/app/statblocks/editor/create/statblockCommands.ts:36 | Obsidian builder | `New statblock here` | menu/modal title |
| src/app/statblocks/editor/create/statblockCommands.ts:41 | Obsidian builder | `Edit statblock in Atlas` | menu/modal title |
| src/app/statblocks/editor/create/statblockCommands.ts:63 | command name | `New statblock…` | command name (next line of addCommand) |
| src/app/statblocks/editor/create/statblockCommands.ts:73 | command name | `Edit statblock` | command name (next line of addCommand) |
| src/app/statblocks/editor/dnd/DropIndicator.tsx:20 | JSX text | `Drop blocks here` |  |
| src/app/statblocks/editor/fs-import/LayoutAdoptionList.tsx:50 | notice (showNotice) | `Couldn't import the layout.` | notice |
| src/app/statblocks/editor/fs-import/LayoutAdoptionList.tsx:57 | JSX text | `Fantasy Statblocks layouts` | third-party product name |
| src/app/statblocks/editor/fs-import/LayoutAdoptionList.tsx:58 | JSX text | `Statblocks of this collection drawn with a Fantasy Statbloc…` | third-party product name; HTML entity in text |
| src/app/statblocks/editor/fs-import/LayoutImportDialog.tsx:80 | JSX text | `Cancel` |  |
| src/app/statblocks/editor/fs-import/LayoutImportDialog.tsx:84 | JSX text | `Open template` |  |
| src/app/statblocks/editor/fs-import/LayoutImportDialog.tsx:88 | JSX text | `Not now` |  |
| src/app/statblocks/editor/fs-import/LayoutImportDialog.tsx:92 | JSX text | `Done` |  |
| src/app/statblocks/editor/fs-import/LayoutImportParts.tsx:67 | JSX text | `Moving statblocks: ${phase.done} of ${phase.total}` |  |
| src/app/statblocks/editor/fs-import/fsImportCommands.ts:35 | Obsidian builder | `Import as statblock template` | menu/modal title |
| src/app/statblocks/editor/fs-import/fsImportCommands.ts:50 | command name | `Import Fantasy Statblocks layout…` | third-party product name; command name (next line of addCommand) |
| src/app/statblocks/editor/gallery/AttributionPopover.tsx:20 | JSX text | `Read the licence` |  |
| src/app/statblocks/editor/gallery/StatblockSourcePanel.tsx:81 | JSX text | `No statblocks in this vault yet` |  |
| src/app/statblocks/editor/gallery/StatblockSourcePanel.tsx:82 | JSX text | `No statblock matches` |  |
| src/app/statblocks/editor/gallery/StatblockSourcePanel.tsx:104 | JSX text | `This statblock has no values to build a template from` |  |
| src/app/statblocks/editor/gallery/StatblockSourcePanel.tsx:105 | JSX text | `Choose a statblock to build a template from its values` |  |
| src/app/statblocks/editor/gallery/TemplateGallery.tsx:131 | notice (showNotice) | `Couldn't create the template.` | notice |
| src/app/statblocks/editor/gallery/TemplateGallery.tsx:169 | JSX text | `New template` |  |
| src/app/statblocks/editor/gallery/TemplateGallery.tsx:192 | JSX text | `Cancel` |  |
| src/app/statblocks/editor/gallery/UseForField.tsx:21 | object `label` | `Nothing yet` |  |
| src/app/statblocks/editor/gallery/UseForField.tsx:26 | JSX text | `Starts new statblocks for` |  |
| src/app/statblocks/editor/gallery/galleryActions.ts:119 | notice (showNotice) | `This statblock has no values to build a template from.` | notice |
| src/app/statblocks/editor/gallery/gallerySources.ts:30 | object `label` | `This system` |  |
| src/app/statblocks/editor/gallery/gallerySources.ts:31 | object `label` | `All built-ins` |  |
| src/app/statblocks/editor/gallery/gallerySources.ts:32 | object `label` | `Simple` |  |
| src/app/statblocks/editor/gallery/gallerySources.ts:33 | object `label` | `From a statblock` |  |
| src/app/statblocks/editor/gallery/gallerySources.ts:34 | object `label` | `From Fantasy Statblocks` | third-party product name |
| src/app/statblocks/editor/gallery/gallerySources.ts:35 | object `label` | `Blank` |  |
| src/app/statblocks/editor/openStatblockEditor.ts:73 | notice (showNotice) | `Couldn't find ${options.notePath}.` | notice |
| src/app/statblocks/editor/openTemplateEditor.ts:62 | notice (showNotice) | `Couldn't find that template.` | notice |
| src/app/statblocks/editor/rests/RuleCard.tsx:39 | object `label` | `recoveryEditor.kind.full` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:40 | object `label` | `recoveryEditor.kind.amount` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:41 | object `label` | `recoveryEditor.kind.share` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:42 | object `label` | `recoveryEditor.kind.set` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:43 | object `label` | `recoveryEditor.kind.spend` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:48 | object `label` | `recoveryEditor.kind.step` | i18n-looking key as label, verify |
| src/app/statblocks/editor/rests/RuleCard.tsx:49 | object `label` | `recoveryEditor.kind.clear` | i18n-looking key as label, verify |
| src/app/statblocks/editor/statblock-pane/ChangeTemplateDialog.tsx:63 | JSX text | `Change template` |  |
| src/app/statblocks/editor/statblock-pane/duplicateTemplate.ts:23 | notice (showNotice) | `The copy is there, but this statblock could not switch to i…` | notice |
| src/app/statblocks/editor/statblock-pane/duplicateTemplate.ts:29 | notice (showNotice) | `Couldn't duplicate the template.` | notice |
| src/app/statblocks/editor/template-editor/editorGlyphs.ts:26 | Obsidian builder | `Paragraphs` |  |
| src/app/statblocks/editor/template-editor/editorGlyphs.ts:26 | Obsidian builder | `Number` |  |
| src/app/statblocks/editor/template-editor/editorGlyphs.ts:26 | Obsidian builder | `Rating` |  |
| src/app/statblocks/editor/template-editor/editorGlyphs.ts:26 | Obsidian builder | `Dice` |  |
| src/app/statblocks/editor/template-editor/editorGlyphs.ts:26 | Obsidian builder | `One of a list` |  |
| src/app/statblocks/editor/template-editor/save/saveTemplate.ts:47 | notice (showNotice) | `${noteName(path)} uses ${name} now.` | notice |
| src/app/statblocks/editor/template-editor/shell/NoteTextModal.ts:13 | Obsidian builder | `Find a note to start from` |  |
| src/app/statblocks/editor/template-editor/shell/startFromNote.ts:36 | notice (showNotice) | `${name} has no text to start from.` | notice |
| src/app/statblocks/model/blockCatalogue.ts:225 | Obsidian builder | `Heading` |  |
| src/app/statblocks/model/templateGrid.ts:56 | Obsidian builder | `Value` |  |
| src/app/statblocks/model/templateGrid.ts:56 | Obsidian builder | `Metric` |  |
| src/app/statblocks/model/templateGrid.ts:56 | Obsidian builder | `Abilities` |  |
| src/app/statblocks/model/templateGrid.ts:56 | Obsidian builder | `Counters` |  |
| src/app/statblocks/model/templateGrid.ts:56 | Obsidian builder | `Divider` |  |
| src/app/statblocks/settings/TemplateList.tsx:62 | notice (showNotice) | `Couldn't copy the template.` | notice |
| src/app/statblocks/settings/TemplateList.tsx:86 | notice (showNotice) | `Couldn't delete the template.` | notice |
| src/app/toolbar/toolbarCatalog.ts:61 | Obsidian builder | `Roll on the random tables in your notes and loot bases.` |  |

### Rest (not in the table): 423 hits, counts per directory (src/app/online rows are online (do not touch))

| Directory | Hits |
|---|---|
| src/app/statblocks | 246 |
| src/app/online | 131 |
| src/app/pixi | 20 |
| src/app/audio | 12 |
| src/app/packages | 9 |
| src/app/experimental | 2 |
| src/app/support | 1 |
| src/app/toolbar | 1 |
| src/app/react | 1 |

### Method

Scope: `main.ts` and `src/`, excluding `src/app/i18n/`, `*.test.*`, `tests/`, `__tests__/`, `*.d.ts`. Read-only; raw hits kept in `/tmp/claude-atlas/raw/`, filtering in `/tmp/claude-atlas/scripts/`.

rg commands run (each with the globs above):
```
rg -n "(showNotice|new Notice|\.notice|\.notify|notify)\(" main.ts src            # Notice + Atlas showNotice wrapper
rg -n "\.(setName|setDesc|setTitle|setText|setButtonText|setPlaceholder|setTooltip|setDynamicTooltip|setCtaText|setHeading|setWarning)\(|titleEl|createEl\(|addOption\(|addItem\(|setMenuItem|addRibbonIcon|text:\s*['"`]|\bdesc(ription)?:\s*['"`]" main.ts src
rg -n --glob '*.tsx' -e '(aria-label|placeholder|label|title|alt|aria-description)="[^"{]*[A-Za-z]' -e '>[^<>{}]*[A-Za-z][^<>{}]*<' src main.ts
rg -n "addCommand\(|name:\s*['"`]" main.ts src
rg -n "\b(label|description|tooltip|placeholder|title|message|name|hint|help|caption|subtitle|heading|prompt|question|confirm|cancel|body):\s*['"`]" main.ts src
rg -n "setName\(|setDesc\(|setTitle\(|setText\(|setPlaceholder\(|setButtonText\(|setTooltip\(" src main.ts   # manual check of literal args
rg -n -A3 "addCommand\(\{" <command files>                 # command names on the following line
```

Filters applied by a Python script: skip comment lines, console/logger/throw/import lines; keep only literals with 3+ letters that look like prose (no ids, paths, file names, camelCase or kebab identifiers, `atlas-` classes); drop literals passed to `t(`; drop literals under object keys such as `cls`, `className`, `id`, `key`, `icon`, `kind`, `type`, `path`, `field`, `role`, `tag`, `href`, `src`; drop JSX text that is TypeScript syntax (generics, arrow functions, selectors); drop key-name chips (Ctrl/Cmd, Shift, Esc, Tab). Excluded as game or upstream-English content: `statblocks/presets/`, `gameSystems/presets`, `gameSystems/diceSets.ts`, `gameSystems/senses/`, `support/issueReport.ts`, `statblocks/presets/attributions.ts`, `builtInPresets.ts`. Those directories are reported here as excluded, not as findings.

Limits: the scan is text-pattern based. It misses strings built by concatenation or in arrays of plain strings, and it can flag identifiers that look like prose. Verify each row before fixing it.

## Result (phase 2)

All 892 missing keys are translated: 12 new module files registered in
`zh/index.ts`, 293 keys added to 26 existing files, no existing zh value
changed. Checks: every English key present in zh, identical placeholder sets
per key, plural messages kept as `{ other }` objects, no 您, no half-width
punctuation after Chinese, `npx tsc --noEmit` clean, 12490 unit tests pass,
lint clean, build OK.

Open points for later:
- Resolved after phase 2: `describeSense` (`src/app/gameSystems/senseEditing.ts`)
  used to join `senses.describe.*` fragments with ASCII `", "` and `"."`; the
  separators and sentence end are now keys (`senses.describe.clauseSeparator`,
  `senses.describe.sentence`, `senses.describe.sentenceSeparator`), so Chinese
  gets `，` and `。` while English and Russian output is unchanged.
- `dice.formulaError.modifier` (existing) says 修饰符 for a dice-notation
  modifier (keep, drop, explode), while numeric modifiers are 修正值.
- The initiative tracker card is 卡片 (existing `initiative.card`), the
  initiative deck card is 卡牌 (`initRules.*`).
- `recoveryEditor.notResource` quotes 「Tracked」 because the template editor's
  option label is hard-coded English (`TrackedSetting.tsx`); see the
  hard-coded string list above.
