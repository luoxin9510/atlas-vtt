# Plan: rule pack interface, part A (P3a)

Spec: `docs/superpowers/specs/2026-11-27-rule-pack-api-design.md` (decisions 1-4, 7-10). Branch
`feature/rule-pack-api` from `fork/work`, one commit per task, each task test-first (`tdd`).
Full gate: `npx tsc --noEmit`, `npm run lint`, `npm run check:play`, `npm run check:relay`,
`npm run check:boundaries`, `npx vitest run --project unit`. Then `code-review`, an independent
fresh-context review, `pr`, and the agent merges into `fork/work`.

Rules: explicit return types; files under ~300 lines; no eslint-disable/ts-ignore; UI text via `t()`
(en + zh, glossary); no commercial game names; existing behaviour unchanged unless a decision says so.

## Task 1 — one roll parse options object

P1 left a trailing `defaultFaces?: number` on about 25 functions (parser, text rolls, statblock values,
references, bonuses, notation, coercion, sheet state). Replace it with one small type, e.g.
`RollParseOptions { defaultFaces?: number }` (room for later options), passed as one argument; keep
`statblockRollPieces` vs `rollPieces` as they are. Pure refactor: no behaviour change, tests adapted
mechanically only.

## Task 2 — modifiers move the target of an under check (decision 4)

Armed statblock bonuses and the one-off modifier (Task 4) add to the target when the check's direction
is `under` (`3d6 vs 15` +2 → `3d6 vs 17`) and to the dice when `over` (`1d20+2 vs 15`). The direction is
the one the roll will use (written `≤`/`≥`, else the set's). A formula someone typed is rolled as
written. Named labels for the bonuses still show where the roll shows modifiers.

## Task 3 — roll a statblock value as a check (decisions 3, 9)

A block option beside `rollable` (e.g. `rollAs: 'check'` in the template format, with its editor control
and en/zh text). A value's leading integer becomes the target of `<the set's default roll> vs N`;
no leading integer, no link. Armed bonuses follow Task 2; Shift/Alt advantage as today. Template
validation keeps the option; older Atlas ignores it.

## Task 4 — roll with a modifier (decision 10)

The right-click menu of a check link gets "Roll with a modifier…" (zh 带修正掷…): a small input takes a
signed integer and rolls once with it (Task 2's rule). Escape cancels; nothing is remembered.

## Task 5 — the interface (decisions 1, 2, 7)

`plugin.rulePacks` getter returning `RulePackApi`: `apiVersion: 1`, `whenReady(): Promise<void>`,
`registerCheckRule(id, rule): () => void`, `checkRuleIds()`, `rollCheck(formula, target, options?)` and
`rollDice(text, options?)` (on the open map, else off-map like the statblock pane, returning the result).
Types in `docs/fork/rule-pack-api.d.ts`, kept in step by a test. Registrations are dropped when Atlas
unloads. Presets, templates and dice sets: documented as vault files a pack writes (no API).

## Task 6 — docs and gate

Upstream `CLAUDE.md` (template option, modifiers rule), `docs/fork/ARCHITECTURE.md` ("Rule packs"),
`docs/fork/rule-pack-api.md` (how a pack connects, with a short example), full gate, reviews, PR, merge.
