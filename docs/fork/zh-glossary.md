# zh glossary and style guide

Terminology and style for the Simplified Chinese (`zh`) locale of Atlas VTT,
derived from the existing `src/app/i18n/locales/zh/` files (about 1,545 keys
paired with English by key) and applied to every new translation. Counts are
the number of existing zh values that use a rendering. "decided" marks terms
the existing zh never used, chosen for this fork.

Note: Obsidian's `zh-TW` also resolves to this Simplified Chinese locale
(`resolveLocale` falls back to the base language; `tests/unit/i18n.test.ts`).

## Glossary
| English | zh | example key | notes |
|---|---|---|---|
| token | 棋子 | token.kill, am.menu.editToken | 89 uses; 令牌/标记 0. Never 角色牌. |
| token ring | 棋子环 / 环 | token.ringColor | |
| scene | 场景 | am.menu.renameScene | 51 |
| map | 地图 | am.menu.renameMap | 95 |
| encounter | 遭遇 | am.menu.spawnEncounter | 28; "Spawn" = 放置 (am.menu.spawnTokens) or 放到…上 |
| statblock | 属性块 | am.menu.linkStatblock | 55; "Link/Unlink" = 关联/取消关联 |
| fog / fog of war | 迷雾 / 战争迷雾 | toolbar.deleteFog, issue.area.vision | 迷雾 in tools/UI; 战争迷雾 only for the full phrase "fog of war" (1) |
| initiative | 先攻 | initiative.card, token.addInitiative | 16 |
| initiative tracker | 先攻追踪 | widgets.initiativeTracker | no trailing 器 |
| initiative panel | 先攻面板 | lpv.showInitiative | |
| round | 第 {round} 轮 | playerInit.round | 轮 = round |
| turn | 回合 | hotkey.nextTurn (下一回合) | 回合 = turn; keep 轮/回合 distinction |
| initiative side / card / deck | 阵营 / 卡牌 / 牌堆 (decided) | initRules.addSide, initRules.deck | "Act earlier/later" 提前行动 / 推后行动 |
| players (tab, party) | 玩家 | am.tab.party | |
| combat | 战斗 | hotkey.group.combat | |
| grid | 网格 | grid.show, align.title | 23 |
| square (grid) | 方格 ; "per square" 每格 | align.square, csm.grid.distance | |
| hex | 六角格 | grid.type.hexFlat | flat-top 平顶, pointy-top 尖顶 |
| cell | 格子 | grid.hexNumbers | 2 uses; use 格子 for "cell", 格 as counter-word |
| segment (clock) | 格 / 格数 | widgets.segments, clock.fill | |
| wall | 墙 ; counter 面墙 | toolbar.drawWalls, wall.deleteMany | |
| door / secret door | 门 / 密门 | wall.placeDoor, wall.placeSecretDoor | |
| light (source) | 光源 | light.configure | 6 |
| lighting | 光照 | sceneLight.settings | 13; 照明/灯光 0 |
| dynamic lighting | 动态光照 | sceneLight.dynamic | |
| vision | 视野 | csm.tab.vision, vision.range | 7; 视觉 0 |
| unlimited / all around | 无限 / 环视四周 | vision.unlimited, vision.allAround | |
| sense(s) | 感官 (decided) | senses.title (en only) | zh has no 感知. 感官 avoids clash with 视野 and D&D 感知 (Wisdom skill Perception) |
| darkvision | 黑暗视觉 (decided) | senses.* | Chinese 5e community: 黑暗视觉 (also 暗视). Use 黑暗视觉; tremorsense 震颤感知, blindsight 盲视, truesight 真实视觉 (proposed) |
| dim light / darkness | 微光 / 黑暗 (decided) | senses.editor.inDim/inDark | 5e Chinese convention: 微光 |
| condition | 状态 | csm.conditions.add, am.system.conditions | 19; 条件 0. Also renders "Status" (token.reset) |
| resource | 资源 | editToken.resources | 1 |
| bar | 条 | am.system.ownSummary | |
| HP | 生命值 | token.reset | full "生命值" only; hit dice 生命骰; no "HP" in zh |
| collection | 合集 | am.menu.moveToCollection | 74; 集合 0 |
| asset | 素材 | am.deleteFailed | 28; 资产 0 |
| asset manager | 素材库 | csm.filters.intro | 9; the same word is also used for "library" (am.tour.libraryTitle) |
| library (Atlas) | 素材库 | atlasLinks.encounterMissing | "library" = 素材库. Exception: icon "Library" 图书馆 (pin.icon.library) |
| vault (Obsidian) | 库 | atlasLinks.fileMissing, bundle.comparing | Obsidian zh calls it 仓库/库; repo uses 库 |
| player view | 玩家视图 | command.sendMapToPlayerView | 24 |
| player window | 玩家窗口 | command.openPlayerWindow | 16 |
| session view | 场面视图 | toolbar.sessionView | |
| GM view | 主持人视图 | toolbar.gmView | see inconsistency below |
| DM screen | DM 屏 | hotkey.dashboard | |
| dashboard | 仪表盘 | command.openDashboard | |
| snapshot | 快照 | palette.sceneSnapshots | 17 |
| pin (map) / note pin | 图钉 / 笔记图钉 | hotkey.pin | 11; 固定 only for verb "pin open/unpin" (dice.pin, preview.pin) |
| note | 笔记 | dashboard.linkNote | 42 |
| drawing | 绘图 | toolbar.deleteDrawings | pen 画笔, eraser 绘图橡皮, laser pointer 激光笔 |
| ruler | 尺子 | csm.system.intro | 1 |
| measure / measurement | 测量 | csm.tab.grid | 14 |
| layer | 图层 (decided) | none | zh never uses; 图层 matches Obsidian/graphics apps |
| widget | 小组件 | csm.tab.widgets | 20; 控件/部件 0 |
| counter / clock / timer | 计数器 / 时钟 / 计时器 | widgets.type.clock | |
| dice / die | 骰子 | dice.noRolls | 骰 15 |
| roll (dice) | 掷 / 投掷 | dice.rollAgain 再掷一次, dice.rollFormula 投掷 {formula} | 掷 8, 投掷 5; both fine (noun 投掷, verb 掷) |
| roll (random-table draw) | 抽取 | loot.count, tour.loot.historyBody | 21; keep 抽取 for loot, 掷 for dice |
| critical (dice) | 大成功 / 大失败 (decided) | diceLab.critNaturalHint | critical success 大成功, critical failure 大失败; the rule label "Critical" 大成功规则; "never critical" 不会出现大成功或大失败. Not 暴击 (video-game term) |
| loot | 战利品 | loot.received | 14 |
| random table | 随机表 | csm.tab.loot | 9 |
| Base (Obsidian Bases) | Base / Bases | csm.loot.addBase | kept English, space before/after |
| rarity / tier / CR | 稀有度 / 层级 / 挑战等级 | loot.rarity.legendary(传说), am.rating.cr | |
| preset | 预设 | am.system.presetName | 9 |
| game system | 游戏系统 | am.create.system | |
| template | 模板 (decided) | none | 模板 over 模版 (Obsidian convention) |
| bundle (export file) | 合集包 | bundle.reading | other "bundle" cases: 打包 (bundle.packed); "Bundled" in changelog.notBundled = 附带 |
| import / export | 导入 / 导出 | am.sidebar.import | 26 / 19 |
| campaign | 战役 | am.tour.collectionBody | 3 |
| quest | 任务 | pin.icon.quest | |
| rest | 休息; short rest 短休, long rest 长休 (decided) | csm.widgets.timerDesc | |
| character | 角色 | am.manage.characterTags | |
| creature | 生物 | am.link.selectCreature | 7; 怪物 0 |
| party | 队伍 | tour.loot.historyBody | |
| folder / tag | 文件夹 / 标签 | am.folder.delete | |
| trash | 回收站 | am.manage.toTrash | |
| toolbar | 工具栏 (decided) | toolbar.* has no such label | |
| command palette | 命令面板 | toolbar.commandPalette | 3 |
| settings | 设置 | csm.close | 27 |
| undo / redo | 撤销 / 重做 | history.undo | 3 / 3; 恢复 = restore (common.restore) |
| spawn | 放置 / 放到…上 | am.menu.spawn | |
| freeze (player camera) | 冻结玩家镜头 | player.* | |
| shortcut / hotkey | 快捷键 | hotkey.title | |

### Inconsistencies found
- GM vs DM: 主持人视图 (hotkey.gmView, toolbar.gmView, 2) vs DM 屏 (hotkey.dashboard, 1). Recommend: 主持人 for "GM" (neutral, matches TTRPG zh community usage 主持人/GM), keep 「DM」 only where English source says DM.
- Library: 素材库 (9) is used for both "asset manager" and "library"; bare 库 (19) is almost always Obsidian "vault". Recommend: 素材库 = asset manager/Atlas library, 库 = vault.
- Roll: 掷 (8) vs 投掷 (5) vs 抽取 (21). Recommend: dice = 掷/投掷, random-table/loot = 抽取 (consistent split already).
- Cell: 格子 (2) vs 格/方格 (4, 47). Recommend: 格子 for generic "cell", 方格 for square grid type, 格 only as counter word (每格, 一格).
- Ellipsis: 39 values use "…" and 25 use "..." (all 25 mirror an en value that itself has "..."; en has 43 "…", 25 "..."). Recommend: copy whatever the en value uses.

## Style rules
1. Pronoun: 你, never 您 (您 0 uses; 你 42). e.g. bundle.keptLocal; am.tour.collectionBody "你可以随时在这里切换合集。"
2. Sentence punctuation is full-width: ，(90) 。(191) ：(42) ？(15) （ ）(37) ；(10) 、(27). Half-width , . ? ! after Chinese: 0 uses. e.g. am.deleteFailed '删除素材「{name}」失败：{error}'. ！ is never used (0).
3. Quotes: 「」 (41), never “”. Used for interpolated names: am.folder.confirmDelete '确定要删除文件夹「{name}」吗？'. Only literal ASCII " is kept in names.invalidScene.
4. Ellipsis: mirror en ("…" or "..."), see above. e.g. toolbar/map: map.loading '正在加载地图...' (en "..."), light.configure '设置光源…' (en "…").
5. Spacing: one space between Chinese and Latin text and between Chinese and numbers/placeholders; none between Chinese and full-width punctuation. 53 values have "中文 Latin", 0 have it joined.
   Examples: am.link.missing '请安装并启用 Fantasy Statblocks 插件，才能关联属性块。'; am.menu.deleteItems '删除 {count} 项'; playerInit.round '第 {round} 轮'.
   Exception: placeholder for a type word sits flush: am.empty.none '还没有{tab}', csm.filters.filterBy '按{field}筛选', sort.current '按{field}排序（点击更改）' (these are words, not counts). Rule of thumb: spaces around {count}/{n}/{value}/{key}-type numbers and names; flush against {tab}/{field} that expand to Chinese nouns.
   Digits inside units stay tight: token.size.large '大型（2×2）'; '3 个' pattern is always "{count} 个棋子" (am.menu.nTokens).
6. Counters: {count} 个 (generic), 项 (items), 张 (maps/images: cleanup.backgrounds '{count} 张地图背景'), 条 (messages), 面 (walls), 颗 (dice), 件 (loot items).
7. Buttons/menus: short verb-first, no 吗, no trailing 。: 'Rename Scene' 重命名场景, 'Spawn Encounter' 放置遭遇, 'Save' 保存, 'Delete All Fog' 删除全部迷雾. No "请" in buttons; Title Case disappears. Toggle commands use 开关 (command.toggleDiceLog '开关骰子记录'), while explicit settings use 显示/隐藏 (token.show, widgets.showInitiative '显示先攻追踪').
8. Sentences: complete sentences end with 。 (177 values); labels/titles/hints without a verb do not. Confirmations end in 吗？ ('确定要删除「{name}」吗？'). Errors: 无法 + verb ('无法重命名场景'); "Could not X" = 无法X, "Failed to X: {error}" = X失败：{error}.
9. Instructions: 请 + verb (30 uses) is used for imperatives in notices: align.noGrid '请改为手动对齐。', bundle.tooNew '请先更新 Atlas 再导入。'.
10. Placeholders: kept verbatim ({name}, {count}, {error}, {path}, {key}, {tab}, {field}), reordered to match Chinese grammar; every zh value has the same placeholder set as en (0 mismatches). e.g. atlasLinks.snapshotOf '{scene} 的快照' (en "Snapshot of {scene}"); am.spawnedPartial reorders {count}/{expected}.
11. Plurals: all 51 zh plural objects keep only `other` (0 with `one`). e.g. am.menu.nTokens { other: '{count} 个棋子' }; wall.deleteMany { other: '删除（{count} 面墙）' }. Do the same.
12. Product names stay in English: Atlas, Atlas VTT, Obsidian, Fantasy Statblocks, Base/Bases, NPC/PC. e.g. atlasLinks.openWithAtlas '用 Atlas 打开'; hotkey.intro '可在 Obsidian 设置 → Atlas VTT → 地图快捷键 中修改。'
13. Keys/UI paths: key names stay Latin (Enter, Esc, Shift) with spaces and " + ": initiative.editHint 'Enter 保存 · Esc 取消'; hotkey.shiftArrows 'Shift + 方向键'. Mouse: 右键, 滚轮, 悬停, 点击. Separator "·" for hints (creator.cropHint '拖动调整位置 · 滚动缩放 · 双击重置'), "→" for menu paths. Dash: "——" (am.card.statblockLinked), range en-dash "2–1,000" kept.
14. Plain words used for UI terms: 取消 (cancel), 保存 (save), 删除 (delete, not 移除; 移除 = remove from a list e.g. csm.loot.removeBase), 重命名, 关联, 筛选 (filter), 排序, 导入/导出.

## Decisions on inconsistencies and open terms

- **GM / DM**: 主持人 for "GM" (主持人视图). Keep the letters DM only where the
  English source says DM (DM 屏).
- **Library / vault**: 素材库 = Atlas library and asset manager; 库 = the
  Obsidian vault.
- **Roll**: dice 掷 / 投掷; random tables and loot 抽取.
- **Cell**: 格子 = a cell; 方格 = the square grid type; 格 only as a counter.
- **Ellipsis**: mirror the English value ("…" or "...").
- **Critical**: 大成功 / 大失败, as Chinese TTRPG communities say, not 暴击.
- Existing wording left as it is (out of scope for this phase): `toolbar.sessionView`
  场面视图, `pin.icon.npc` NPC.
