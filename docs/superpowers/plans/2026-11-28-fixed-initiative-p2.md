# Plan: fixed-value initiative (P2)

**Spec:** `docs/superpowers/specs/2026-11-28-fixed-initiative-design.md` (decisions 1-8).

**Branch:** `feature/fixed-initiative`, from `fork/work`. Each task is test-first (`tdd`).

**Finish:** full gate, as in P3; then `code-review`, an independent fresh-context review and `pr`; then the agent merges.

**Rules:**
- explicit return types;
- files under ~300 lines;
- no eslint-disable or ts-ignore;
- UI text via `t()`, in en and zh (see the glossary);
- no commercial game names;
- nothing changes for presets without `value`.

## Task 1: rules and values

- Parse and validate `InitiativeRules.value` and `tieBreak`: turn-order mode only, with field paths.
- Read a combatant's value and tie-break numbers from its statblock, by field paths and scores slots.
- Join and read-all fill `initiative` without dice.
- A typed value wins until it is cleared.
- Ties are broken by the tie-break fields, then by one hidden random roll kept for the encounter.

## Task 2: tracker UI

- In fixed mode, the roll-all button reads "Read from statblocks".
- The per-combatant roll button is hidden.
- Decimals show as written in the tracker, the edit popup and the player app.
- Waiting combatants show as they do today.

## Task 3: docs and gate

- Update `CLAUDE.md`, `ARCHITECTURE.md`, the preset docs and schema, and the zh glossary.
- Run the full gate and the reviews, open the PR, and merge.
- Afterwards, locally, in the GURPS pack:
  - the preset uses value = Basic Speed, tie-break = DX;
  - `initiative_key` is removed from the template, the importer and the samples;
  - the pack version becomes 3.
