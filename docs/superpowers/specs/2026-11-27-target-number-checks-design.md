# Target-number checks (P1)

Status: grilled and agreed with the owner, 2026-11-27 (15 decisions, below). Branch
`feature/target-checks`, PR into `fork/work`.

## Decisions from the grill

1. Scope stays whole: notation, check rules, bare-faced dice, GM-only rolls, display.
2. Notation `vs` plus `≤`/`≥`; ASCII `<=`/`>=` keep meaning tallies.
3. Direction: preset/set field `check`; unset follows `crit: 'roll-under'`, else over.
4. Display wording (zh): 成功，差 N / 失败，差 N / 大成功 / 大失败，差 N; en: "Success by N" style.
   System-specific words (a pack's own term for margin) are the pack's business, not Atlas'.
5. P1 ships one built-in rule (`builtin:margin`) and an internal registry; P3 opens it to packs.
6. Bare-faced dice only where the set opts in (`bareDie: true`).
7. GM-only rolls: tray toggle; hidden from the player window; secret entry online; `hidden` kept
   in the scene's roll log.
8. Entry points: tray input, clickable check text, `DiceTool.rollCheck`. Sheet buttons per skill
   belong to the rule pack (G2), built on `rollCheck`.
9. The partial work stopped before the grill (branch `wip/p1-before-grill`) is reviewed against
   this spec; matching parts are reused with tests written first, the rest dropped.
10. The GM-only toggle stays on until switched off (highlighted while on), across scenes and restarts.
11. A check clicked outside a map uses the open map's collection; with no map open, the library's
    default collection; with no system there, `over`.
12. New terms go into `docs/fork/zh-glossary.md` (done).
13. Implementation is test-first (`tdd`), one subagent per task, reviewed before each commit.
14. Review: `code-review` (standards + spec), then an independent fresh-context review; PR body
    via `pr` with the review record.
15. Platform PRs (P1, P3, P2) are merged into `fork/work` by the agent once reviews pass and the
    full gate is green; the owner is told afterwards. (Owner decision 2026-11-27.)

Second grill (dice animation, 2026-11-27, all recommendations accepted):

16. Keep Atlas' existing 3D dice; no new renderer.
17. Showing 3D dice in a note window when a dice link is clicked with no map open is a separate
    small plan and PR after P1 (not in this branch).
18. 3D panel, card and log show the check line under the total once the dice land; crit sparks,
    glow and sound follow `check.crit` when a roll has a check, else `crit` as today.
19. A GM-only roll still plays on the GM's own screen with a small "GM only" badge (3D, card, log);
    nothing on the player window; a secret entry online.
20. The dice dropdown gets a formula input at its top: type a formula or check, Enter rolls it,
    honouring the GM-only toggle (the tray had no free-text input).

Online fact checked during the grill: `parseSharedRoll` keeps only keys it knows, so an optional
`check` field needs no protocol level bump; older player apps show the total without the line.

## Why

Atlas rolls dice and can count dice that meet a number (`5d10>=8`), but it cannot judge a whole
roll against a target: "roll 3d6, succeed on 14 or less, by how much". Many systems are built on
that check (roll-under percentile and 3d6 systems, roll-over d20 systems with a DC). This plan
adds it as a **system-agnostic platform feature**. Nothing in the code, tests or docs names a
particular commercial game; rule packs that know a system's details plug in later (P3, a
separate plan) through the rule registry this plan introduces.

It is the first of the platform milestones from the fork owner's "Atlas is a platform, rule packs
live outside" decision: P1 checks, P3 rule-pack interface, P2 fixed-value initiative, P4 player
app checks.

## Goals

1. A check notation people can type and statblocks can hold.
2. A check result on every roll that has a target: success, margin, critical success or failure.
3. Critical rules for checks that can depend on the target, chosen by the game system and
   replaceable through a registry (built-in rules now, registered rules in P3).
4. Bare-faced dice (`1d+2`, `2d-1`) for systems whose dice set opts in: `d` means the set's die.
5. GM-only checks from the Obsidian dice tray: rolled, logged for the GM, kept from the player
   window and online players.
6. The result shows in every place a roll shows: card toast, roll log, 3D panel, online table log.

## Non-goals

- Changing the meaning of any formula Atlas parses today. In particular `3d6<=14` stays a tally
  (count of dice showing 14 or less) and `1d20+5>=15` stays a syntax error.
- Contests between two rolls, initiative changes, player-app check input (P4).
- Any system-specific critical table in Atlas itself.

## Notation

A check is a formula, a separator, and a whole-number target:

| Written | Meaning |
|---|---|
| `3d6 vs 14` | check against 14 in the system's direction |
| `1d100 vs 45` | same |
| `3d6 ≤ 14` | roll-under: succeed when the total is at most 14 |
| `1d20+5 ≥ 15` | roll-over: succeed when the total is at least 15 |

- `vs` is case-insensitive and must stand between spaces. `≤`/`≥` (U+2264/U+2265) may touch the
  numbers. ASCII `<=`/`>=` are **not** check separators because they already mean tallies.
- The target is an optional sign and 1-9 digits. Only the last separator in the text counts, and
  the formula part must parse on its own with today's parser, so tallies and checks can combine
  (`4d10>=8 vs 2`: count successes, then check the count).
- Parsing is a pure split before the existing parser (`parseCheck(text) -> {formula, target,
  direction?}` or null); `parseFormula` is unchanged. The text-roll recogniser (`textRolls.ts`)
  strips spaces, so it splits on the separator before it removes them.
- Limits: the whole text counts toward `FORMULA_LIMITS.characters`.

## Direction

`RollingDice` and `DiceRules` gain `check?: 'under' | 'over'`. Unset, the direction is `under`
when the set's `crit` is `roll-under`, else `over`, so today's roll-under sets get the right
default without editing. `≤`/`≥` in the text override the set. Built-in sets and presets are not
changed except where the default would be wrong (none found).

## Evaluating a check

A check result is added to `DiceRollResult`:

```ts
interface CheckResult {
  target: number;
  direction: 'under' | 'over';
  /** Signed: >= 0 succeeded by that much, < 0 failed by that much. under: target - total; over: total - target. */
  margin: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** The rule that decided it (a built-in id or a registered one). */
  rule: string;
}
```

A **check rule** decides `success` and `crit`:

```ts
interface CheckRuleInput { total: number; target: number; direction: 'under' | 'over'; margin: number; dice: readonly RolledDie[]; defaultDice: readonly RolledDie[]; diceCrit: DiceCrit }
type CheckRule = (input: CheckRuleInput) => { success: boolean; crit: 'success' | 'failure' | null };
```

- Built-in rule `margin` (the default): `success = margin >= 0`; `crit` maps the set's existing
  dice crit (`high` -> `success`, `low` -> `failure`); a critical success always succeeds and a
  critical failure always fails.
- `RollingDice`/`DiceRules` gain `checkRule?: string`. Unset means `margin`.
- `src/app/dice/checkRules.ts` holds the registry: `registerCheckRule(id, rule)` (returns an
  unregister function), `checkRule(id)`. Built-in ids are prefixed `builtin:`; P3 exposes
  registration to rule packs. An id nobody registered falls back to `margin` and the result's
  `rule` says which rule actually ran.
- Preset and dice-set validation keep any non-empty `checkRule` string (an unknown id is data a
  rule pack provides later, never an error) and accept `check` only as `under`/`over`.

## Bare-faced dice

`RollingDice`/`DiceRules` gain `bareDie?: true`. Where it is set, `Nd` with no faces means the
set's first die (`dice[0].sides`); elsewhere `1d+2` stays text. The parser takes an optional
`defaultFaces` and records `faces` as resolved, so everything after parsing (limits, rolling,
labels, averages) sees a normal die. Places that parse with a known set pass it: the dice tool,
statblock values (the statblock's set), the text-roll recogniser where a collection is known.
`diceNotation.ts` (statblock averages) takes the same option.

## GM-only checks (and rolls)

`RollOptions.visibility?: 'all' | 'gm'`. A GM-only roll goes to the GM's roll history and toast,
is marked `hidden: true` on the result, is never sent to the player window, and reaches online
players as the existing secret entry (`SecretEntry`). The dice tray gets a toggle (eye icon,
`LabelTooltip`), on until switched off and highlighted while on (decision 10). Not persisted in scene files beyond what the roll log
already stores; a hidden roll in the scene's `diceLog` keeps `hidden: true` so a reload does not
reveal it.

## Showing a result

- A shared formatter `checkLine(result)` -> "Success, by 3" / "Failure, by 2" / "Critical success"
  / "Critical failure, by 11" (i18n `dice.check.*`, en and zh).
- Card toast, roll log entry, 3D panel caption: the line under the total; crit styling reuses the
  existing crit classes, driven by `check.crit` when there is a check, else by `crit` as today.
- Online: `SharedRoll` gains an optional `check` with strict parsing; protocol level unchanged
  because the field is optional and older players' parsers drop unknown keys (checked).
- `quietRoll` and `rollDiceFormula` share one result builder so both get `check`.

## Entry points in this plan

- Dice tray input and the dice dropdown accept check text.
- `DiceTool.rollCheck(formula, target, options)` for code (rule packs, statblock buttons).
- Statblock and note text rolls: a value such as `3d6 vs 14` is a roll link.
- Not in this plan: player app check input (P4), initiative.

## Tests

- `parseCheck`: separators, spaces, case, signs, last separator wins, tallies unchanged
  (`3d6<=14` still a tally), length limits.
- Direction defaults from crit rules; override by `≤`/`≥`.
- `margin` rule over every 3d6 total for an under target and every d20 total for an over target;
  crit mapping; registry register/unregister/fallback.
- Bare dice: opt-in on, off; averages; text rolls.
- Visibility: hidden roll not emitted to the player window bus path, secret entry online.
- Result builder shared by quiet and normal rolls; `SharedRoll.check` parse round trip.
- UI: toast/log/3D caption render the line (jsdom).

## Docs

Upstream `CLAUDE.md` "Game system presets" gets the new `check`, `checkRule`, `bareDie` fields;
`docs/fork/ARCHITECTURE.md` gets a short "Checks and check rules" section;
`docs/fork/online-contract.md` documents `SharedRoll.check`.
