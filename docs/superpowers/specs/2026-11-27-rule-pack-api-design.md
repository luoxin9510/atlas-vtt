# Rule pack interface (P3)

Status: grilling with the owner, 2026-11-27. Branches `feature/rule-pack-api` (P3a), then P3b and P3c,
each a PR into `fork/work`, merged by the agent once reviews pass and the full gate is green.

## Why

Atlas is a system-agnostic platform; a game system's own rules live in a separate Obsidian plugin
(a *rule pack*) in the same vault. P1 gave Atlas target-number checks and an internal check rule
registry. P3 lets a rule pack plug into it, adds the generic pieces most rule packs need (checks from
statblock values, contests, character importers), and keeps everything system-agnostic: no
commercial game names in code, tests or docs.

## Facts found (2026-11-27)

- Other plugins reach Atlas through `app.plugins.plugins[atlasPluginId()]`. The plugin class already
  offers two typed getters for other plugins: `presentedScene` and `tableChat` (`main.ts`). No `api`
  object, no version, no ready signal exist.
- `src/app/dice/checkRules.ts` is module-private; nothing outside the bundle can call it. An unknown
  `checkRule` id already falls back to `builtin:margin`, so a pack that loads late breaks nothing.
- Presets, dice sets and statblock templates are vault files only (`atlas-vtt/system-presets`,
  `atlas-vtt/dice-sets`, any `.atlastemplate`); services write them, nothing registers them by code.
- A statblock value click rolls either the formula in its text or, for a `rollable` block, the number
  as a bonus (`+N`). There is no "roll as a check against this value".
- Armed statblock bonuses and typed modifiers are added to the dice, which is wrong for a roll-under
  check: `3d6 vs 15` with +2 rolls `3d6+2 vs 15` instead of `3d6 vs 17`.
- `createStatblockNote` (frontmatter is the statblock), `AssetService.addTokenAsset`,
  `TokenStatblockLinkService.linkTokenToStatblock` exist; no importer registry and no contests exist.
- Atlas' Fantasy Statblocks integration (`FantasyStatblocksService`) is the model for the other side:
  typed minimal interface, readiness check, fail soft.

## Decisions (round 1, all recommendations accepted)

1. `plugin.rulePacks`: a typed interface with `apiVersion: 1`; its type declarations ship as
   `docs/fork/rule-pack-api.d.ts` for packs to copy. Every registration returns an unregister function.
2. `whenReady()` resolves once Atlas has finished loading; packs register after it.
3. A statblock template block option "roll as a check": clicking value 15 rolls
   `<the set's default roll> vs 15`. Data only, so a pack needs no per-skill buttons.
4. For an `under` check, modifiers (armed bonuses, typed `+2`) move the target (`3d6 vs 17`); for
   `over` they stay on the dice (`1d20+2 vs 15`). A fix to P1, shipped in P3a.
5. Atlas provides generic contests: both sides roll a check, the result card shows both and the
   winner; a registered contest rule decides winner and ties.
6. Atlas provides the import flow; a pack registers an importer (file kind + parse to name, template,
   field values, image). Atlas creates the note and token, links them, keeps current damage on
   re-import, and offers the command.
7. Presets, templates and dice sets stay vault files; a pack writes or updates its own on load.
8. Three PRs: P3a (interface, `whenReady`, check rules, roll as a check, modifiers into the target,
   bundling P1's trailing `defaultFaces?` into one options object), P3b (contests), P3c (importers).

## Decisions (round 2, all recommendations accepted)

9. Roll as a check reads the leading integer of the value (`15 (DX+2)` → 15); a value without one gets
   no link. Shift/Alt advantage keeps working where the set has an advantage rule.
10. Right-clicking a check link offers "Roll with a modifier…": a small input takes `-2` and rolls once
    with it (moving the target for `under`, decision 4). Armed bonuses still apply; nothing is remembered.
11. Contests start three ways: right-click a check link → "Start a contest…", then click the opponent's
    check link (Escape cancels); the dropdown input accepts `12 对 14` / `12 vs 14` shorthand and full
    `3d6 vs 12 对 3d6 vs 14`; and `rollContest(a, b)` in the interface.
12. Built-in contest rule: a success beats a failure; otherwise the larger margin wins; equal margins
    are a tie, shown as such. Packs may register other contest rules.
13. "Import character file…" opens the system file picker (several files); Atlas reads, never copies,
    the files. The note records the source path and importer id; "Re-import" on the note or token
    reads it again.
14. Atlas asks for the collection (default: the open map's); notes go to its `characters/` folder,
    portraits beside them, tokens into its token library (not placed on a map). Notes inside the
    collection folder pick up the collection's system (bare dice and so on).
15. Re-import keeps current damage (resources' current values, clamped to the new maximum), the
    tokens' conditions, and the note body below the statblock; only imported fields are replaced.

P3b (how a contest's dice are thrown in 3D, online display) and P3c (portrait formats, conflicts on
re-import) get a short grill of their own before they start.
