# Plan: target-number checks (P1)

Spec: `docs/superpowers/specs/2026-11-27-target-number-checks-design.md`. Branch
`feature/target-checks` from `fork/work`, one commit per task, PR into `fork/work` when the full
gate is green (`npx tsc --noEmit`, `npm run lint`, `npm run check:play`, `npm run check:relay`,
`npm run check:boundaries`, `npx vitest run --project unit`). Merging is the owner's decision.

Rules for every task: explicit return types; files under ~300 lines; no inline eslint-disable or
ts-ignore; UI text through `t()` with en and zh keys; no system names from commercial games in
code, tests or docs; never change existing parse results (the existing dice tests must stay green
unchanged).

## Task 1 — check notation and data types

- `src/app/dice/checkTypes.ts`: `CheckDirection`, `CheckResult`, `CheckRuleInput`, `CheckRule`.
- `src/app/dice/parseCheck.ts`: `parseCheck(text)` -> `{ formula, target, direction? } | null`
  per the spec's notation (last separator, `vs` between spaces, `≤`/`≥`, signed 1-9 digit target).
- `DiceRules` and `RollingDice` gain `check?`, `checkRule?`, `bareDie?`; `rollingRules()` carries
  them; preset and dice-set validation keep them (unknown `checkRule` ids kept, `check` only
  `under`/`over`, `bareDie` only `true`). Equality helpers (`sameDiceRules` etc.) compare them.
- Tests: `tests/unit/dice/parseCheck.test.ts`, validation round trips.

## Task 2 — check rules and evaluation

- `src/app/dice/checkRules.ts`: registry (`registerCheckRule`, `checkRule`, `checkRuleIds`),
  built-in `builtin:margin`.
- `src/app/dice/evaluateCheck.ts`: `checkDirection(rolling, written?)`, `evaluateCheck(...)`
  -> `CheckResult` (fallback to margin with `rule` naming what ran).
- Tests: every 3d6 total under 10/14 and every d20+5 total over 15; crit mapping; registry.

## Task 3 — rolling a check

- One result builder used by `rollDiceFormula` and `online/gm/quietRoll.ts`.
- `DiceRollResult.check?: CheckResult`; `DiceTool.rollDice` accepts check text;
  `DiceTool.rollCheck(formula, target, options)`; update `diceSourceOf` guard if needed.
- Tests: tool rolls with scripted random sources; quiet roll carries the check.

## Task 4 — bare-faced dice

- Parser option `defaultFaces` (`parseFormula`, `formulaTerms.ts` DICE, `textRolls.ts` DIE/ROLLS,
  `statblocks/values/diceNotation.ts`); callers with a known set pass `bareDie ? dice[0].sides`.
- Tests: off by default (`1d+2` not a roll), on with a d6 set, averages, statblock dice field.

## Task 5 — GM-only rolls

- `RollOptions.visibility`; `DiceRollResult.hidden?: true`; player window never shows hidden
  rolls; online GM rolls marked hidden go out as `SecretEntry`; scene `diceLog` keeps `hidden`.
- Dice tray toggle (icon button with `LabelTooltip`), en/zh strings.
- Tests: player window filter, online audience, file round trip.

## Task 6 — showing the result, online field, text rolls

- `checkLine(result)` + i18n `dice.check.*` (en, zh); toast, roll log entry, 3D caption, online
  `RollRow`; crit styling from `check.crit` when present.
- `SharedRoll.check` with strict parse (protocol note in `docs/fork/online-contract.md`; bump the
  level only if older parsers reject unknown keys).
- Text rolls: a check in statblock/note text is a roll link that rolls the check.
- Tests: jsdom renders, protocol round trip, text-roll recognition.

## Task 7 — docs and gate

- Upstream `CLAUDE.md` "Game system presets" bullets for `check`, `checkRule`, `bareDie`;
  `docs/fork/ARCHITECTURE.md` "Checks and check rules"; full gate green; whole-branch review.
