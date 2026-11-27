# Rule pack interface

Atlas is system-agnostic. A game system's own rules live in a separate Obsidian plugin in the same
vault: a **rule pack**. Atlas offers a pack one small interface, `plugin.rulePacks`, and the rest
of what a pack adds is plain vault files. No game is named in Atlas.

The types are in [`rule-pack-api.d.ts`](rule-pack-api.d.ts). Copy that file into your plugin; it is
self-contained, and a test (`tests/unit/rulePacks/rulePackDeclaration.test.ts`) keeps it in step with
Atlas's own types (`src/app/rulePacks/rulePackApi.ts`). The interface has `apiVersion: 1` and grows
only by additions while it stays 1.

## Getting the interface

Obsidian keeps loaded plugins by id, and the id differs between builds: the repository's plugin id
is `atlas-vtt`, a local install of this fork uses `atlas-vtt-fork`. Try both, then wait for Atlas
to finish loading:

```ts
import type { RulePackApi } from './rule-pack-api';

const plugins = (this.app as any).plugins.plugins;
const atlas = plugins['atlas-vtt-fork'] ?? plugins['atlas-vtt'];
const rulePacks: RulePackApi | undefined = atlas?.rulePacks;   // undefined: Atlas is not installed or too old
await rulePacks?.whenReady();
```

`whenReady()` resolves once Atlas has loaded (settings, dice sets and views exist). It never
resolves if Atlas unloads first. Register after it.

## Registering a check rule

A check is dice text ending in a target (`3d6 vs 10`, `1d20+5 >= 15`). A check **rule** decides
whether it succeeded and whether it is critical. Atlas's own is `builtin:margin`. A dice set or a
system preset names the rule it wants in its `checkRule` field; an unknown id is kept as data and
judged by `builtin:margin`, so a pack that loads late breaks nothing.

Example: roll-under 3d6, a critical success on a total of 3 or 4, a critical failure on 17 or 18.

```ts
const remove = rulePacks.registerCheckRule('mypack:3d6-under', ({ total, target, direction }) => {
  const success = direction === 'under' ? total <= target : total >= target;
  const crit = total <= 4 ? 'success' : total >= 17 ? 'failure' : null;
  return { success, crit };
});
this.register(remove);   // unregisters when your plugin unloads
```

- Ids starting with `builtin:` are refused with an error; name yours `<pack>:<rule>`.
- Registering an id again replaces the earlier rule.
- `registerCheckRule` returns the function that removes it. Call it in your `onunload` (here through
  `this.register`). Atlas also removes whatever is left when it unloads, and a registration after
  that does nothing; register again after Atlas loads.
- `checkRuleIds()` lists the registered ids, Atlas's first.
- The input also carries `margin`, the rolled `dice`, `defaultDice` and `diceCrit` (the set's own
  critical result), so a rule can build on the set's crit instead of reimplementing it.

## Rolling

```ts
rulePacks.rollDice('2d6+3');
rulePacks.rollCheck('3d6', 12, { direction: 'under', visibility: 'gm' });
```

- On the open map, the roll goes through that map's dice tool: it lands in the map's roll log, is
  thrown on the map (3D dice, online table) and follows `visibility` (`'gm'` keeps it from the
  player window and online players).
- With **no map open** the roll is quiet: nothing is shown and nothing is logged, the result is
  yours to display. It uses the dice set of `collectionId`, else the default d20 set (`direction`
  still applies to checks).
- Both return `null` for text they refuse (and `rollCheck` for a target that is not a whole
  number). `rollDice` also accepts a check written as text (`3d6 vs 10`).
- The result's `check` carries the verdict: `target`, `direction`, `margin` (signed, positive =
  succeeded by that much), `success`, `crit` and the `rule` that decided it.

## Presets, dice sets and statblock templates are vault files

There is no API for them. A pack writes (and on load updates) its own files, as a user would:

| What | Where | Notes |
| --- | --- | --- |
| System preset | `atlas-vtt/system-presets/*.json` | one JSON file each; the `id` inside is the identity, not the path |
| Dice set | `atlas-vtt/dice-sets/` | collections and templates pick from the vault's sets |
| Statblock template | a `.atlastemplate` file anywhere in the vault | the default folder for new ones is `atlas-vtt/statblock-templates` |

Fields that matter for checks (in a dice set, and in the `dice` rules of a system preset):

- `check`: `'under'` or `'over'`, the direction of a check. Unset: under for a `roll-under` crit
  rule, else over.
- `checkRule`: the registry id of the rule that judges checks (`mypack:3d6-under` above).
- `bareDie`: `true` makes a die written without faces (`3d`) mean the set's first die.

In a statblock template, a `stat`, `metric`, `scores` or `pairs` block can take `rollAs: 'check'`
(the "Roll as a check" option in the template editor) instead of `rollable`. The leading whole number
of the value is then the target of a check against the set's default roll: clicking `15 (DX+2)` rolls
`3d6 vs 15` for a 3d6 set (Shift/Alt advantage works where the set has an advantage rule). A value
without a leading number gets no link. It is written alone, so an older Atlas rolls nothing instead
of the number as a bonus; if both are set, the check wins.

### Modifiers and `under` checks

Armed statblock bonuses and the one-off modifier ("Roll with a modifier..." on a check link's
right-click menu) move the **target** of a check that goes under, since a higher target is the easier
roll there: `3d6 vs 15` with +2 rolls `3d6 vs 17`. For `over` checks they stay on the dice:
`1d20+2 vs 15`. A formula someone typed is rolled as written.

## What is coming

- P3b: contests, where both sides roll a check, the result card shows both and the winner, and a
  registered contest rule decides winner and ties (`rollContest` joins the interface).
- P3c: importers, where a pack registers a character file importer and Atlas creates the note and
  token, links them and keeps current damage on re-import.

Design and decisions: `docs/superpowers/specs/2026-11-27-rule-pack-api-design.md`.
