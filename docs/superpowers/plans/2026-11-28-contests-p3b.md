# Plan: contests and follow-ups (P3b)

Spec: `docs/superpowers/specs/2026-11-27-rule-pack-api-design.md` (decisions 5, 11, 12, 16-24). Branch
`feature/contests` from `fork/work`, one commit per task, each test-first (`tdd`). Full gate as in
P3a. Then `code-review`, an independent fresh-context review, `pr`, and the agent merges.

Rules: explicit return types; files under ~300 lines; no eslint-disable/ts-ignore; UI text via `t()`
(en + zh, glossary); no commercial game names; behaviour for ordinary rolls unchanged.

## Task 1 — contest core

- Types: `ContestResult { winner: 'first' | 'second' | null; rule: string }`; a contest is two check
  results. Registry beside check rules: `registerContestRule`, built-in `builtin:contest-margin`
  (a success beats a failure, else larger margin, equal margins tie). Sets/presets may name
  `contestRule` (kept like `checkRule`; unknown → built-in, failing rules fall back and log once).
- Contest text (decision 19): split on ` 对 ` / ` against ` (one separator; each side a check or a
  bare target completed with the set's default roll); `parseContest`.
- `DiceTool.rollContest(first, second, options)` → both `DiceRollResult`s sharing a `contest` field
  (`{ id, side: 'first' | 'second', names?, verdict on the second }`); `rollDice(text)` accepts
  contest text. Quiet rolls and GM-only follow the normal paths (decision 21).

## Task 2 — showing a contest

- Two panels in the roll stack, verdict line under the second once both landed (decision 17); card
  mode shows both cards and the verdict; the log groups the pair as one entry (decision 18).
- Online: `SharedRoll.contest` optional, strict parse that drops only the field when unreadable;
  the table log groups the pair; older players see two rolls.

## Task 3 — starting a contest

- Check link right-click → "Start a contest…" (zh 发起对抗…): the next check link clicked is the
  second side; Escape or a click elsewhere cancels; a hint shows while waiting. Names from the
  statblocks (decision 20); typed contests use 第一方 / 第二方.
- The dropdown input accepts contest text.

## Task 4 — how a moved target was built (decision 22)

`CheckResult` gains the written target and the steps that moved it (`{ label?, value }[]`) when
modifiers moved it; `checkLine` companion `targetLine()`; shown in 3D, card, log, online (strict
parse, optional).

## Task 5 — entry extras roll as a check (decision 23)

Template format, editor and rendering for number extras of entries, reusing the block option code.

## Task 6 — re-register signal (decision 24)

`markReady()` also triggers `app.workspace.trigger('atlas-vtt:rule-packs-ready')` each time; the
interface gains `registerContestRule` and `rollContest`; d.ts and `docs/fork/rule-pack-api.md`
updated (re-register on the event).

## Task 7 — docs and gate

CLAUDE.md, ARCHITECTURE.md, online-contract.md, rule-pack-api.md; full gate; reviews; PR; merge.
Afterwards (local, not in this PR): atlas-gurps listens for the event.
