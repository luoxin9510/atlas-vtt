# Fixed-value initiative (P2)

Status: grilled with the owner 2026-11-28, all recommendations accepted. Branch `feature/fixed-initiative`.

## Facts found

- `InitiativeRules` is declared in `types/initiativeRulesTypes.ts` and parsed by `gameSystems/initiativeRules.ts`. Its keys are:
  - `mode`, `roll`, `firstSide`
  - `modifier`, `modifierFallback`
  - `sides`, `sideRoll`
  - `deck`, `dealEachRound`, `lookAlikesShare`
  - `rollHitPoints`

  It has no fixed-value, tie-break or sort keys.
- A roll is `rollInitiativeDice(roll) + modifier`. The statblock modifier comes from the first of:
  1. `rules.modifier`
  2. the `initiative` meaning
  3. the Fantasy Statblocks `modifier`
  4. `rules.modifierFallback`
- The tracker sorts descending by `initiative`, then by `tieBreakModifier`, then by the existing order. Dragging settles ties.
- Values can already be typed per combatant.
- Online, the GM sends `SharedCombatant.initiative: number`, with `unnumbered` for unrolled entries. Players show the number as is.

## Decisions

1. **Fixed value.** `initiative.value: { field }` in a preset means no roll: a combatant's initiative is that statblock field's number, and `roll` is then not needed. It applies only to `mode: "turn-order"`.
2. **Tie-break.** `initiative.tieBreak: [{ field }, ...]`: when values are equal, these fields are compared in order, higher first. If still equal, one hidden random roll is made when the combatant joins and kept for the encounter. Dragging still works.
3. **Field paths.** Fields are named with Atlas' existing field paths, for example a score slot such as the DX of an attributes table. The exact paths are verified while implementing. The GURPS pack then uses value = Basic Speed and tie-break = DX, and drops its `initiative_key` stopgap (local, pack version 3).
4. **When values are read.** Values are read when a combatant joins, and again by the roll-all button, which in fixed mode reads "Read from statblocks". A value the GM typed wins until the GM clears it.
5. **Display.** In fixed mode the per-combatant roll button is hidden. Values show as written (`5.25`); decimal display is added where needed.
6. **Missing field.** A combatant without the field (no statblock, or an empty value) waits (`–`) like an unrolled one, and the GM types a value.
7. **Online.** No protocol change: players see the values and the order.
8. **Sort order.** Descending only; there is no ascending option.
