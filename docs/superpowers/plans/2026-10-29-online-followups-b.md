# Online follow-ups, wave B: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the Plan 3 residuals and the over-long online files listed in `docs/fork/online-followups.md`: pin the note copy against adversarial input, close three "typed name shown" gaps, stop shared notes flickering or staying withdrawn after a transient error, and split four files over the ~300 line guideline.

**Architecture:** Tests first (pins that are green on the current code), then small behaviour fixes with TDD, then pure refactors, one per task and never mixed with behaviour. The note copy (`src/app/online/gm/notes/`) is the anti-goal boundary; every change there fails closed.

**Tech Stack:** TypeScript, vitest (project `unit`), micromark/mdast, React (player app `apps/play`).

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (6.4 shared notes: "never the typed target or a path", "never the file name"). Measured inputs and current outputs for every item: `.superpowers/sdd/recon-wave-b.md` (section numbers below are its item numbers). Base: `feature/online-followups-a` at 1586b951.

## Global Constraints

- Anti-goal: nothing the GM hides may reach a player (unshared notes, `[!gm]`, `%%comments%%`, HTML, frontmatter, link targets, titles, file names). Any change in `src/app/online/gm/notes/` fails closed: when unsure, drop.
- Never remove or alter license headers, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `CLA.md`; never change `manifest.json` / `versions.json`.
- Explicit return types on every function; files under about 300 lines; no `eslint-disable`, `@ts-ignore`, `@ts-expect-error`; no mock data outside tests.
- UI text through `t()`; keys, logs and protocol stay English. No new translation keys in this plan.
- Never log note text, titles, hashes, keys, tickets or table secrets.
- Refactor tasks change no behaviour: the existing tests stay green unchanged, apart from moved imports.
- Run tests in the foreground; subagents never dispatch subagents.
- Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VhBMZn91fCVnzp544cpjN3`.
- Gate per task: `npx tsc --noEmit`, `npm run lint`, and the unit tests of the touched area (`npx vitest run --project unit <dir>`). Player tasks add `npm run check:play`; relay test tasks add `npm run check:relay`.

## Review Focus

1. A note whose comment, `[!gm]` callout or HTML is malformed (unclosed, nested, lazy lines): the copy must cut or drop, never show the hidden part. Pinned in Task 1.
2. A GM hides a note while its chunks are still queued and batched: no chunk of the old text may leave after `dropTagged`. Pinned in Task 1.
3. A note links to another note that is renamed, moved, unshared or retitled mid-game: the linking note may stay listed only when no title it could show has gone. Task 4 tests every one of these cases.
4. A sync tool briefly locks a shared note file: the note must come back without the GM editing it, and must never come back from a stale read. Task 4.
5. Constructor wiring order in `OnlineTable` after the options-object refactor (connection created last, shares through lazy getters): the control harness tests must stay green. Task 6.

---

### Task 1: Pins (tests only, green on current code)

**Files:**
- Test: `tests/unit/online/gm/notes/playerCopy.test.ts` (new `describe('more adversarial pins')`)
- Test: `tests/unit/online/gm/sendBatch.test.ts`
- Test: `tests/unit/play/session.test.ts`

- [ ] **Step 1:** In `playerCopy.test.ts`, using the file's `copy(text)` helper, add one `it` per recon item-2 group 1-8 with the exact inputs and outputs from recon section 2 (`toBe` where the recon gives an exact output, `not.toContain('SECRET')` for every input). Also pin the two "documented as visible" frontmatter cases (blank line before `---`, and `...` as a closing fence) with a comment `// parity with Obsidian checked 2026-10-29`. Do NOT pin `'a <!-- unclosed SECRET\n\nSECRET2'` (Task 2 changes it).
- [ ] **Step 2:** In `sendBatch.test.ts`, add the three tests from recon section 6 (`'leaves a dropped tag out of the next batch'`, `'drops tagged frames held back while the socket drains'`, `'drops the tagged rest of a full batch'`), with the assertions given there.
- [ ] **Step 3:** In `session.test.ts`, add `'leaving clears the shared notes'`: after `welcome`, a `notes` game message (send `{ t: 'client', level: 3 }` first if the feed needs the level) lists the note; `session.join(...)` empties `notes`, and so does `session.backToForm()`.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/online/gm tests/unit/play/session.test.ts`. Expected: all pass. If a pin fails, it found a bug: stop and report it with the input; do not change product code in this task.
- [ ] **Step 5: Commit** `Tests: pin note copy, tagged batches and leave()`.

### Task 2: Copy fixes (items 3, 4, 5 and the unclosed HTML comment)

**Files:**
- Modify: `src/app/online/gm/notes/copyLinks.ts` (`namesTheFile`), `src/app/online/gm/notes/playerCopy.ts` (`phrasing`, `withoutBrokenWikiLinks`, `imageNode`)
- Test: `tests/unit/online/gm/notes/playerCopy.test.ts`

**Interfaces:**
- `namesTheFile(caption: string, path: string): boolean` (same signature, wider match)
- `withoutBrokenWikiLinks(value: string, open: boolean): { text: string; open: boolean }`

- [ ] **Step 1: Failing tests.**
  - Extend `'drops an image caption that is the file name'` with `'![Sécret](Sécret.png)'`, `'![Folder/Secret.png](Folder/Secret.png)'`, `'![Secret%2520Map](Secret%20Map.png)'` and `'![[Folder/Secret.png|Folder/Secret]]'`, each expecting `/^!\[\]\(atlas-asset:/`. The existing `![[Secret.png|The Secret]]` keeps `The Secret`.
  - Extend `'drops a broken wikilink from text'` with the first three inputs of recon section 4, asserting `not.toContain('Secret')`, `not.toContain('rest')` and no `]]` left; plus `'a ![[Secret.png unclosed'` → no stray `!`.
  - In the tightening block, add `'refuses an image ref whose hash is not lowercase hex'`: targets whose `image` returns `hash: 'Z'.repeat(64)`, then `'a'.repeat(63) + ')'`, then uppercase hex, each giving markdown `''` and `images.size === 0`.
  - Add `'cuts the copy at an unclosed inline html comment'`: `copy('a <!-- unclosed SECRET\n\nSECRET2')` contains neither `SECRET` nor `<!--`, and keeps `a`.
- [ ] **Step 2:** Run the file; the new tests fail.
- [ ] **Step 3:** Implement as recon sections 3, 4 and 5 (c) describe:
  - `namesTheFile` compares a canonical form (decode up to 3 times until stable, NFKC, lower case, `[\s_.\-/\\]+` → one space, trim) against the full path, the path without its extension, the name, and the name without its extension. It stays an equality test.
  - The broken-`[[` drop runs at sibling level in `phrasing()`. Skipped non-text siblings still go through `drop()` so an open comment still cuts. A `!` before a removed `[[` goes too, and `open` resets at the end of `phrasing`.
  - `imageNode` builds the href once and returns `[]` when `assetImageOf(href) === null`.
  - An inline html node starting `<!--` without a `-->` cuts the rest of the copy, the same way `hasOpenComment` handles `%%`.
  - Ruling: an unclosed `<!--` fails closed, without checking Obsidian's rendering. The cost if wrong: a note with a stray `<!--` shows less to players.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/online/gm/notes`. All pass, including every Task 1 pin.
- [ ] **Step 5: Commit** `Notes: hide file names, broken links and bad refs from the copy`.

### Task 3: Player callout title and a dock nit (items 12, 14)

**Files:**
- Modify: `apps/play/src/notes/callout.ts`, `apps/play/src/notes/NoteMarkdown.tsx`, `src/app/online/gm/dock/knockStack.ts`
- Test: `tests/unit/play/noteMarkdown.test.tsx`

**Interfaces:** `defaultCalloutTitle(type: string): string` in `callout.ts` (first letter upper case, the rest unchanged).

- [ ] **Step 1: Failing test** next to the callout test in `noteMarkdown.test.tsx`:
  - `draw('> [!warning]\n> careful')` → `.atlas-play-callout-title` has text `'Warning'`;
  - `'> [!tldr]\n> x'` → `'Tldr'`;
  - `'> [!warning] Mind\n> x'` → `'Mind'`;
  - `'> [!madeup]\n> x'` → no `.atlas-play-callout`.
- [ ] **Step 2:** In `renderQuote`, when the callout is known and has no title, render the title div with `defaultCalloutTitle(split.head.type)`. GM copy unchanged. No translation key (Obsidian shows the type untranslated).
- [ ] **Step 3:** In `knockStack.ts`, move the `NAME` doc comment and constant below the imports, next to `KNOCK_WIDTH`.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/play tests/unit/online/gm/dock*`, `npm run check:play`, `npm run lint`.
- [ ] **Step 5: Commit** `Player: show the type as a callout's default title`.

### Task 4: NotesShare: no flicker, bounded retry, under 300 lines (items 7, 8, part of 9)

**Files:**
- Create: `src/app/online/gm/notes/linkKey.ts`, `src/app/online/gm/notes/failedReads.ts`
- Modify: `src/app/online/gm/notes/NotesShare.ts`, `src/app/online/gm/notes/sharedNotes.ts`, `src/app/online/gm/notes/tableNotes.ts` (pass `timers`), and the `OnlineTable.ts` call that builds the notes share
- Test: `tests/unit/online/gm/notes/notesShare.test.ts`, new `tests/unit/online/gm/notes/failedReads.test.ts`

**Interfaces:**
- `interface LinkState { readonly key: string; readonly shown: ReadonlySet<string> }`. `shown` holds `${id}:${title}` of the shared targets.
- `linkState(links: Readonly<Record<string, number>>, info: (path: string) => SharedInfo | undefined): LinkState`. The key is the sorted `shown` only: no paths, no unshared targets.
- `class FailedReads`, constructed with `(timers: Timers, retry: (path: string) => void, delays: readonly number[] = [2_000, 10_000, 60_000])`:
  - `skip(path: string, stamp: string): boolean`
  - `mark(path: string, stamp: string, transient: boolean): void`
  - `clear(path: string): void`
  - `clearAll(): void`
- `moveKeys(maps: ReadonlyArray<Map<string, unknown>>, from: string, to: string): void` in `sharedNotes.ts`.
- `NotesSharePorts.timers?: Timers` (default `companionTimers()`).

- [ ] **Step 1: Failing tests** in `notesShare.test.ts`, `fails closed` block, as recon section 7 (d):
  - an unshared link target renamed or moved: A stays in `titles`, nothing dropped, no rebuild read;
  - a shared target moved to another folder: A stays listed with unchanged text;
  - A already links to a note that then gets shared: A stays listed while the read is held, then gains the link;
  - a shared target retitled: A is withdrawn at once and listed again after the read is released.

  Also, as recon section 8 (d), with a fake `Timers`:
  - one rejected read, then success, comes back after `advance(2_000)`;
  - a read that always rejects makes exactly 4 reads and none after `stop()`;
  - an oversize copy is never retried.

  Plus unit tests for `FailedReads`:
  - attempts reset when a new stamp is marked;
  - `clear` cancels the timer;
  - non-transient marks schedule nothing.
- [ ] **Step 2:** Run; the new tests fail.
- [ ] **Step 3:** Implement as recon sections 7 (c) and 8 (c):
  - `sync` withdraws only when a pair of the old `shown` is missing from the new state;
  - it rebuilds whenever the key differs, and keeps the old entry listed while only pairs were added;
  - `fail()` takes `transient`: `false` for oversize, `true` for the read `catch`;
  - the retry clears the marker and calls `sync(new Set())`, keeping the `turns` guard;
  - `failed` markers are cleared when a note leaves the set or is deleted;
  - `renamed` uses `moveKeys`;
  - fix the stacked doc comments at `NotesShare.ts:50-52`.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/online/gm`. All pass: the existing `'does not read it again for the same source'` test holds when its clock is not advanced, and the unshare-withdraw test is still green. `wc -l NotesShare.ts` is under 300.
- [ ] **Step 5: Commit** `Notes: keep linked notes listed and retry a failed read`.

### Task 5: Refactor obsidianSyntax.ts (item 1, no behaviour change)

**Files:**
- Create: `src/app/online/gm/notes/commentBody.ts`, `commentSyntax.ts`, `wikiLinkSyntax.ts`, `syntaxCodes.ts`
- Modify: `src/app/online/gm/notes/obsidianSyntax.ts`

**Interfaces:** `commentBody(effects: Effects, hooks: { atEnd: State; atClose: State; afterClose: State }): State`; `obsidianSyntax()` keeps its export and signature (only `parseNote.ts` imports it).

- [ ] **Step 1:** Run `npx vitest run --project unit tests/unit/online/gm/notes`: green baseline (includes the Task 1 pins).
- [ ] **Step 2:** Split as in recon section 1 (c). The inline and flow comment constructs share `commentBody`; inline's re-entry to `inside` after a data run becomes `atClose = closing`. Recon explains why this is equivalent; if any test changes, revert that unification and keep the two paths.
- [ ] **Step 3:** Run the same tests: identical results. Every new file is under 150 lines and `obsidianSyntax.ts` is under 40.
- [ ] **Step 4: Commit** `Refactor: split the Obsidian syntax extension`.

### Task 6: OnlineTable options object and split (item 9)

**Files:**
- Create: `src/app/online/gm/tableShares.ts`, `src/app/online/gm/tableWiring.ts`
- Modify: `src/app/online/gm/OnlineTable.ts`, `src/app/online/gm/OnlineControl.ts` (the one `new OnlineTable(` at about line 312), `docs/fork/online-contract.md:80`

**Interfaces:**
- `interface OnlineTableOptions { app; origin; table: CreatedTable; mapPath: string | null; ownership; seats; gate; paused: boolean; events: OnlineTableEvents; shelf; savedLog?: unknown }`, exported from `OnlineTable.ts`. The field types are exactly today's positional types.
- `constructor(options: OnlineTableOptions)`.
- `tableShares.ts`: `buildShares(deps)` creates the shares from the constructor block (recon section 9). The connection and the binding come in as getters: `connection: () => TableConnection`, `bound: () => SceneBinding | null`.
- `tableWiring.ts`: `connectionHandlers(ports)` and `sceneWatch(ports)`.

- [ ] **Step 1:** Baseline: `npx vitest run --project unit tests/unit/online` is green. Note the count.
- [ ] **Step 2:** Refactor. Keep the construction order: `forkClients` before the notes and pause shares, the connection created last. Fix the stacked doc comments at `OnlineTable.ts:399-400`. Update the prose in `online-contract.md`.
- [ ] **Step 3:** Same tests, same count, green. `OnlineTable.ts` is under 300 lines, and so is each new file.
- [ ] **Step 4: Commit** `Refactor: OnlineTable takes an options object`.

### Task 7: OnlineControl split (item 10, no behaviour change)

**Files:**
- Create: `src/app/online/gm/controlStart.ts`, `controlEvents.ts`, `controlTokens.ts`
- Modify: `src/app/online/gm/OnlineControl.ts`
- Test: `tests/unit/online/gm/selfHostedStart.test.ts` (only if missing)

**Interfaces:** as recon section 10 (c):
- `prepareStart(ports, leaf, campaignId, markStarting): Promise<StartedTable | null>`;
- `tableEvents(control, getTable): OnlineTableEvents`;
- token-marking functions over `{ ownership, campaigns, app, current }`.

`closings` is passed as a getter, never a snapshot.

- [ ] **Step 1:** If no test covers "the control closed while the table was being made", add one to `selfHostedStart.test.ts`: the table gets ended, and nothing runs. Run the control tests (`controlParity`, `controlLeak`, `selfHostedStart`, `startBlock`, `createdTable`, `nextTableLink`): all green.
- [ ] **Step 2:** Split. `OnlineControl.ts` ends under 300 lines.
- [ ] **Step 3:** Same tests green; tsc and lint clean.
- [ ] **Step 4: Commit** `Refactor: split OnlineControl start, events and tokens`.

### Task 8: Split the relay players test and close the follow-up list (item 13)

**Files:**
- Create: `tests/unit/relay/tableSuite.ts`, `players.gate.test.ts`, `players.routing.test.ts`, `players.persistence.test.ts`, `players.limits.test.ts`
- Delete: `tests/unit/relay/players.test.ts`
- Modify: `docs/fork/online-followups.md`

- [ ] **Step 1:** Record the test count of `tests/unit/relay/players.test.ts`.
- [ ] **Step 2:** Split as in recon section 13: `useTables()` registers its `afterEach` when called, and the 60 s test keeps `{ timeout: 60_000 }`.
- [ ] **Step 3:** Run `npx vitest run --project unit tests/unit/relay`: same total count, all green. Then run `npm run check:relay`.
- [ ] **Step 4:** In `online-followups.md`:
  - strike the items this plan closed, the same way wave A did (`~~…~~ (done: …)`);
  - update the remaining line counts;
  - drop the `knockStack` `NAME` note.
- [ ] **Step 5: Commit** `Tests: split the relay players suite; update follow-ups`.

## Rulings in this plan

- An unclosed inline `<!--` fails closed: it cuts the copy like an unclosed `%%`. This is chosen over matching Obsidian's rendering. If wrong, a note with a stray `<!--` shows less to players.
- A frontmatter block closed by `...`, or preceded by a blank line, stays visible as text. That matches CommonMark and how Obsidian detects frontmatter: it must start at byte 0 and close with `---`. The controller checks this against Obsidian before the final review; if Obsidian hides it, Task 2's rule extends to it.
- A default callout title is the type with its first letter capitalised and is not translated, as in Obsidian.
- A failed read is retried 3 times (after 2 s, 10 s and 60 s), only for read errors and never for oversize notes.
