# Dice without a map (note-window 3D dice)

Status: grilled with the owner 2026-11-28, all recommendations accepted. This is the separate plan
promised by target-number checks decision 17, and it also finishes that spec's decision 11. Branch
`feature/note-dice`.

## Facts found

- Clicks reach `rollStatblockDice` / `rollStatblockContest` (`services/statblockRolls.ts`). These
  use an open map's dice tool, else the surface's `OffMapRolls` from `OffMapRollsContext`.
- Only the statblock pane and the encounter builder provide `OffMapRolls`, through `PaneDiceRolls`.
  Statblock fences in reading view, note dice links and the sidebar get none. When no map is open,
  their clicks do nothing: no roll and no notice.
- Off-map rolls never reach `DiceTool.record`. They emit no `dice-rolled` event, so nothing logs
  them and `RollShare` does not share them online.
- `rulePacks.rollDice`, `rollCheck` and `rollContest` without a map roll silently (`rollOffMap`).
- The display, `DiceRollDisplay` (3D stack plus cards), needs no map. The pane already mounts it
  without one, as a portal into its own host, with `subscribe` replacing the map bus. The stage pool
  keeps one stage per document.
- Statblock notes outside collection folders have no collection, so they fall back to the built-in default unless their template names a set.
- `diceDisplay` is `card`, `fast` or `full`. The dice log is per map (`viewState.diceLog`).

## Decisions

1. One workspace-level dice layer per window, bottom-right of that window, used by every roll made
   with no map open. The statblock pane and the encounter builder keep their own display.
2. The layer covers note dice links, check links, statblock fences in reading view, and rule-pack
   rolls without a map. All of them now roll and show. Contests, rolling with a modifier, and GM-only
   rolls work there as they do on a map.
3. The existing display setting applies (full, fast or card). A roll shows in the window where it
   was made, popouts included, and Escape dismisses it.
4. Online: a GM roll made with no map open is shared with players like a map roll. A GM-only roll
   leaves only a secret entry.
5. No dice log for these rolls in this PR. The map log is per map; the last 20 off-map rolls are
   only kept in memory for a later global log.
6. When a map is open but not the active tab, the roll goes to that map as today.
7. The dice set with no map open (finishing decision 11) is the set of the collection the note
   belongs to, else the library's default. Atlas has no library-level default set, so the fallback is
   the built-in default (d20); a template's own set still wins over both.
   The set is that of the collection of the statblock note whose dice were clicked, not of the note
   the click happened in (a statblock fence embedded in another note rolls with the statblock's set).
8. A roll counts as made with no map open only where no map is open at all. A statblock that names
   a map that has closed, while another map is open, rolls nowhere (as before): not on the other map,
   whose log and tokens are not its own, and not on the layer. A map open but not on screen keeps
   decision 6.
9. A roll is shown in the window of the clicked element (its `ownerDocument`), not the focused one.
   If that window has closed, the main window's layer shows it.
10. The statblock pane and the encounter builder show their own rolls (decision 1), and those rolls
    are still shared online (decision 4) and kept in the 20-roll history (decision 5): the surface
    tells the roller (`announce`, `displayed`), and the layer leaves them out.
11. "Note dice links" means the dice links inside a statblock rendered in a note (fences in reading
    view, the pane). Atlas has no markdown post-processor for dice text in ordinary notes: only
    `statblock` fences get dice links, so plain `1d20+5` in a note is not clickable.
