# Rule pack interface

Atlas is system-agnostic. A game system's own rules live in a separate Obsidian plugin in the same
vault: a **rule pack**. Atlas offers a pack one small interface, `plugin.rulePacks`, and the rest
of what a pack adds is plain vault files. No game is named in Atlas.

The types are in [`rule-pack-api.d.ts`](rule-pack-api.d.ts). Copy that file into your plugin; it is
self-contained, and a test (`tests/unit/rulePacks/rulePackDeclaration.test.ts`) keeps it in step with
Atlas's own types (`src/app/rulePacks/rulePackApi.ts`). The interface has `apiVersion: 1` and grows
only by additions while it stays 1: a newer Atlas has more members, never different ones, so a pack
that needs a newer one tests for it (`typeof rulePacks.rollContest === 'function'`) instead of
comparing versions.

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

### Registering again when Atlas reloads

Atlas's registrations end when it unloads, and a reloaded Atlas has a **new** interface object: the
one you hold is stale. Each time Atlas is ready (the first time and after every reload) it triggers
the workspace event `atlas-vtt:rule-packs-ready` with the fresh interface as the argument (the
constant is `RULE_PACKS_READY_EVENT` in the declaration). Register in one function, call it for the
current Atlas and on the event:

```ts
const register = (api: RulePackApi): void => {
  this.register(api.registerCheckRule('mypack:3d6-under', rule));
  this.register(api.registerContestRule('mypack:contest', contestRule));
};
const current = (this.app as any).plugins.plugins['atlas-vtt-fork'] ?? (this.app as any).plugins.plugins['atlas-vtt'];
current?.rulePacks?.whenReady().then(() => register(current.rulePacks));
this.registerEvent((this.app.workspace as any).on('atlas-vtt:rule-packs-ready', register));
```

The event is not triggered if Atlas unloads before it is ready. If your plugin loads after Atlas is
ready it has missed the event, which is what the initial `whenReady()` is for (it is already
resolved then). A pack whose old registrations are gone after a reload loses nothing by registering
again: ids are replaced, never duplicated.

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

## Registering a contest rule

A contest is two checks rolled against each other (`3d6 vs 12` against `3d6 vs 14`, or `12 对 14`).
A contest **rule** decides which won. Atlas's own is `builtin:contest-margin`: a success beats a
failure, else the larger margin wins, equal margins tie. A dice set or system names its rule in
`contestRule`; an unknown id is judged by the built-in.

```ts
this.register(rulePacks.registerContestRule('mypack:higher-roll', ({ first, second }) => {
  // each side is a CheckResult: success, margin, crit, target ...
  if (first.crit !== second.crit) return { winner: first.crit === 'success' ? 'first' : 'second' };
  return { winner: first.margin === second.margin ? null : first.margin > second.margin ? 'first' : 'second' };
}));
```

`registerContestRule(id, rule)` follows the same rules as `registerCheckRule` (`builtin:` and empty
ids refused, a later one replaces an earlier one, the returned function removes it, Atlas removes
the rest when it unloads); `contestRuleIds()` lists the ids. A rule returns `{ winner: 'first' |
'second' | null }`; `null` is a tie.

## Rolling

```ts
rulePacks.rollDice('2d6+3');
rulePacks.rollCheck('3d6', 12, { direction: 'under', visibility: 'gm' });
rulePacks.rollContest('3d6 vs 12', '14', { names: { first: 'Ann', second: 'Bo' } });
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
  succeeded by that much), `success`, `crit` and the `rule` that decided it. Where modifiers moved
  the target (armed bonuses on an `under` check), `target` is where it ended, `baseTarget` where it
  started and `targetSteps` the `{ label?, value }` list that moved it.
- `rollContest(first, second, options?)` rolls two checks, each written as a check (`3d6 vs 12`) or
  as a bare target (`12`, the set's default roll against it), and returns both results as a pair,
  or `null` (nothing rolled) for a side that is no check. The first result's `contest` is
  `{ id, side: 'first', names? }`; the second's also carries `verdict: { winner, rule }`
  (`winner` is `'first'`, `'second'` or `null` for a tie). `options` is the same as for a roll plus
  `names`. It is routed like `rollCheck`: on the open map through the map's dice tool (both rolls in
  the log and thrown on the map, shown as one contest), without a map quietly with `collectionId`'s
  set, and `visibility: 'gm'` makes both rolls GM-only.

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
of the number as a bonus; if both are set, the check wins. The `number` extras of an **entries** block
(an attack's skill, say) take the same option, `rollAs: 'check'` on the extra, and roll as a check
the same way.

### Modifiers and `under` checks

Armed statblock bonuses and the one-off modifier ("Roll with a modifier..." on a check link's
right-click menu) move the **target** of a check that goes under, since a higher target is the easier
roll there: `3d6 vs 15` with +2 rolls `3d6 vs 17`. For `over` checks they stay on the dice:
`1d20+2 vs 15`. A formula someone typed is rolled as written.

## What is coming

- P3c: importers, where a pack registers a character file importer and Atlas creates the note and
  token, links them and keeps current damage on re-import.

Design and decisions: `docs/superpowers/specs/2026-11-27-rule-pack-api-design.md`.
