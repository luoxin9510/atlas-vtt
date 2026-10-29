# Online follow-ups, wave D (player UX, file sizes, test gaps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the open residuals in `docs/fork/online-followups.md` that a player or GM can notice: dead presses, lost explored masks, title and focus glitches, endless map retries. Bring `OnlineFeature.ts` under 300 lines, and close the listed test gaps.

**Architecture:** Player app fixes live in `apps/play/src/scene/`. GM fixes live in `src/app/online/gm/`. One extraction in `src/app/plugin/` shrinks the fork's footprint in the upstream `main.ts`. Every fix gets a test that fails without it.

**Tech Stack:** TypeScript, Obsidian plugin API, PIXI v8 (player app), vitest, Node ≥ 22.18 (relay tests).

**Spec:** the residual list `docs/fork/online-followups.md` (lines 28-29, 45-47, 58-59, 83, 85, 87) and contract `docs/fork/online-contract.md`. Measured behaviour, line references and proposals: `.superpowers/sdd/2026-10-29-online-followups-d/recon-wave-d.md` (item numbers below are its numbers). Base: `fork/work` c4c56625.

## Global Constraints

- **No wire contract change:** the same messages, fields and close codes.
- **Anti-goal:** nothing the GM hides may reach a player. Any task touching notes reruns all of `tests/unit/online/gm/notes/` and `tests/unit/online/gm/notesLeak.test.ts`.
- **File size:** files stay under about 300 lines. `apps/play/src/scene/SceneView.ts` is at 300 and `NotesShare.ts` at 299, so a change there must not add net lines.
- **Code style:** explicit return types. No `eslint-disable` and no `ts-ignore`.
- **Gate per task:** `npx tsc --noEmit`, `npm run lint`, and `npx vitest run --project unit` on the touched test folders. Task 6 also runs `npm run check:relay`.
- **Running tests:** run them in the foreground. Never run `npm run build`. Never touch `dev-vault` or the VPS.
- **Commit trailers:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VhBMZn91fCVnzp544cpjN3`.

## Review Focus

1. **A player whose game is paused presses their own token and drags.** The camera pans. Today nothing moves.
2. **A phone loses its connection while a lit scene's explored mask is loading.** After reconnecting it shows the remembered area again. It never shows more than the GM's mask.
3. **The GM renames a shared note.** Players see the new title at once, with no flicker of the note's text. A note linking to it is still rebuilt.
4. **The GM types a server address in settings.** The field keeps focus while typing.
5. **The GM serves no image for an unlit scene's map.** The player stops asking after a bounded number of tries, and asks again after a reconnect or a scene change.

---

### Task 1: A press on a token the player may not drag pans (item 1)

**Files:**
- Modify: `apps/play/src/scene/DragController.ts`
- Modify: `apps/play/src/scene/gestures.ts`
- Modify: `apps/play/src/scene/canvasInput.ts`
- Modify: `apps/play/src/scene/TokenDrags.ts` (re-export)
- Modify: `apps/play/src/scene/SceneView.ts:137` (no net lines)
- Test: `tests/unit/play/canvasInput.test.ts`
- Test: `tests/unit/play/dragController.test.ts`
- Test: `tests/unit/play/gestures.test.ts`

**Interfaces:**
- Produces `canDrag(state: Pick<TableState, 'mine' | 'paused' | 'scene' | 'tokens'>, id: string): boolean` in `DragController.ts`. It returns true only for a token the player owns, that exists, and is not `held`, while the game is not paused and a scene is set. `begin()` uses it.
- The port `isMine` in `GestureOptions` and `CanvasInputOptions` is renamed to `canDrag`.

- [ ] **Step 1: Failing tests**
  - `dragController.test.ts`: a table test of `canDrag`. Own and free gives true. Paused, held, foreign, a missing token and no scene give false. Assert `begin` agrees with `canDrag` on each row.
  - `canvasInput.test.ts`: "a press on a token the player may not drag leaves the camera on and pans". Use `tokenAt: () => 'mine', canDrag: () => false`. The camera port is never called with `false`, and the gestures are `['pan']`.
  - `gestures.test.ts`: "an own token that may not be dragged pans".
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3: Implement**
  - Rename the port and wire it in `SceneView.ts:137` as `canDrag: (id) => canDrag(this.store.getState(), id)`.
  - Import `canDrag` through `TokenDrags.ts` so `SceneView.ts` stays at 300 lines.
  - Add one line to the "Plan 2b residuals" in `online-followups.md`: a pause or hold that arrives mid-drag keeps the camera still until release.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/play`, `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 5:** Commit with the message `Play: a press on a token you may not drag pans`.

### Task 2: Map download asks lazily and backs off; reason text styled (items 6, 7, 5)

**Files:**
- Modify: `apps/play/src/scene/MapDownload.ts`
- Modify: `apps/play/src/scene/SceneView.ts:178` (same line count)
- Modify: `apps/play/src/theme.scss:166-179`
- Test: `tests/unit/play/mapDownload.test.ts`

**Interfaces:**
- `MapDownload.sync(key: string | null, wish: () => MapWish | null, connected: boolean): void` calls `wish()` only when `key` changed.
- Constants: `MAP_RETRY_MS = 10_000` (exists), `MAP_RETRY_MAX_MS = 300_000`, `MAP_MAX_ATTEMPTS = 8`.
- Retry delay after the n-th failure (n from 0) is `min(MAP_RETRY_MS * 2 ** n, MAP_RETRY_MAX_MS)`.
- After `MAP_MAX_ATTEMPTS` failures it stops but stays `failed`.
- The attempt count is reset by `stop()` (a scene change or destroy) and by the reconnect restart.

- [ ] **Step 1: Failing tests** in `mapDownload.test.ts`
  - Change the existing calls to pass thunks.
  - "calls the wish once per key however often it is synced, and again for a new key".
  - Replace "keeps asking" with "backs off 10 s, 20 s, 40 s … capped at 5 min". Assert the times of the load calls.
  - "stops after 8 failures". Advance one hour; the load count stays 8.
  - "a reconnect after giving up asks again with a fresh count".
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3: Implement**
  - Change `MapDownload` as specified, and change `SceneView.ts:178` to pass `() => mapRequest(state, this.lowPower, this.maxTexture, coarsePointer())`.
  - In `theme.scss`, move `.atlas-play-reason { margin: 0; color: var(--text-error); }` out of `.atlas-play-join` to the top level, next to `.atlas-play-welcome`. Delete the nested copy.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/play`, `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 5:** Commit with the message `Play: build the map wish only on a new map; back off unserved maps; style reasons everywhere`.

### Task 3: A lit scene's explored mask is asked again after a reconnect (item 2)

**Files:**
- Create: `apps/play/src/scene/exploredMask.ts`
- Modify: `apps/play/src/scene/LitScene.ts:135-150`, and its deps type at `:30`
- Modify: `apps/play/src/scene/LitHost.ts:14` (widen `assets` to `& ReconnectSignal`)
- Test: `tests/unit/play/exploredMask.test.ts` (new)

**Interfaces:**
- `class ExploredMask { constructor(assets: Pick<AssetLoader, 'load'> & ReconnectSignal, set: (url: string | null) => void); follow(ref: AssetRef | null): void; destroy(): void }`. It uses the same reconnect pattern as `TokenLayer.ts:48,52-59`.
- On a reconnect, a ref whose url is still `null` is loaded again. A loaded mask is never loaded again.
- An answer for a ref that is no longer current is ignored.
- `LitScene` keeps `setExplored` and passes it as `set`. `LitScene.destroy()` calls `mask.destroy()`.

- [ ] **Step 1: Failing tests** in `exploredMask.test.ts`, with a fake `assets` that has a controllable `load` and `fireReconnect()`:
  - (a) A load that resolves `null` sets the mask to null. A reconnect loads again and sets the url.
  - (b) A loaded mask is not loaded again on a reconnect.
  - (c) After `follow(newRef)`, a late answer for the old ref is ignored.
  - (d) After `destroy()`, a reconnect loads nothing.
  - (e) The mask is only set to a url the loader returned for the current ref, never to anything else (fail closed).
- [ ] **Step 2:** Run them and confirm they fail, because the module does not exist.
- [ ] **Step 3: Implement**
  - Move the mask logic out of `LitScene` into `exploredMask.ts` and wire it in.
  - Strike line 58 of `online-followups.md`.
- [ ] **Step 4:** Run `npx vitest run --project unit tests/unit/play`, `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 5:** Commit with the message `Play: ask a lit scene's explored mask again after a reconnect`.

### Task 4: GM: a renamed shared note shows its new title at once; the address field keeps focus (items 3, 4)

**Files:**
- Modify: `src/app/online/gm/notes/sharedNotes.ts`
- Modify: `src/app/online/gm/notes/NotesShare.ts:170-178` (no net lines)
- Modify: `src/app/online/gm/serverSettings.ts:28-29,39-43`
- Modify: `src/app/online/gm/settings.ts:30`
- Modify: `src/app/online/gm/OnlineFeature.ts:110-112`
- Test: `tests/unit/online/gm/notes/notesRetitle.test.ts` (new)
- Test: `tests/unit/online/gm/onlineSettings.test.ts`

**Interfaces:**
- `retitled(entry: Entry, info: SharedInfo): Entry | null` in `sharedNotes.ts` returns `{ ...entry, title, group }` when either differs, and null otherwise.
- `renamed()` and `noteChanged()` replace the held entry with the retitled one and `publish()`. The queued rebuild still follows. The text and ref are unchanged.
- Remove `ServerSettingsHost.sectionsChanged` and its only caller. `OnlineFeature.sectionsChanged` goes too if nothing else calls it.

- [ ] **Step 1: Failing tests**
  - `notesRetitle.test.ts`, using `notesHarness.ts`:
    - Start with shared `Old.md` and call `holdReads`. Move it to `New.md`. The list ANA receives already says `New` while the read is held.
    - Release the read. The note's text is unchanged and its id is kept.
    - A group change shows at once.
    - A note that links to the renamed one is still withdrawn and rebuilt.
  - `onlineSettings.test.ts`:
    - The host stub counts `sectionsChanged`.
    - Typing a valid address calls it 0 times. Write this assertion before changing the code.
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3: Implement.** Strike lines 83 and 85 of `online-followups.md`.
- [ ] **Step 4: Run the checks**
  - `npx vitest run --project unit tests/unit/online` (the notes leak tests included)
  - `npx tsc --noEmit`
  - `npm run lint`
- [ ] **Step 5:** Commit with the message `GM: show a renamed note's title at once; keep focus in the address field`.

### Task 5: `OnlineFeature.ts` under 300 lines; settings-tab wiring out of `main.ts`; server lifecycle tested (items 8, 9c)

**Files:**
- Create: `src/app/online/gm/featureCommands.ts`
- Create: `src/app/online/gm/featureLegacy.ts`
- Create: `src/app/plugin/settingsTab.ts`
- Modify: `src/app/online/gm/OnlineFeature.ts`
- Modify: `main.ts:204-219` and the imports that become unused
- Test: `tests/unit/online/gm/migrateBooksInto.test.ts` (read `legacy.books`)
- Test: `tests/unit/online/gm/serverLifecycle.test.ts` (new)

**Interfaces** (follow wave B's `control*.ts` pattern: free functions or small classes beside the owner, each taking a ports object):
- `registerFeatureCommands(ports: CommandPorts): Map<OnlineCommandId, (checking: boolean) => boolean>`, where `CommandPorts = { app; online: () => OnlineControl; docks: DockMounts; table: () => OnlineTable | null }`.
  - It holds the seven command registrations, `markSelected`, `tokensText` and `command()`.
  - `OnlineFeature.commands` is assigned from it in `start()`, and `runCommand` is unchanged.
- `class LegacyData`. Its constructor takes `ports: { app; bookSource: BoundBookSource; books: BookShelf; save(): Promise<void> }`, and it exposes `books` and `assignments`.
  - It holds `bindBooks`, `migrateBooksInto`, `migrateAssignmentsInto` and `campaigns()`.
  - `OnlineFeature` keeps one-line delegates of the public three.
- `registerSettingsTab(plugin, services): OnlinePlay` in `src/app/plugin/settingsTab.ts` holds the fork's settings-tab wiring now in `main.ts:204-219`. Its `services` are `{ settingsService, changelogService, updateWatch, issueReporter, tableOnlinePlay }`, as recon item 8 names them.
- No other upstream code moves. `main.ts` should land at about 285 lines.

- [ ] **Step 1: Failing test** `serverLifecycle.test.ts` (jsdom; `createInMemoryApp`; `useUpstreamServer()`; stub `registerEvent` on the instance):
  - Loading with data `{ serverOrigin: 'https://tables.example.com' }` makes `relayOrigin()` return that origin and `settingsSections()` non-empty.
  - `unload()` makes `relayOrigin()` null.
  - Unloading while the data read is pending never applies the origin.
  - This pins current behaviour, so it may pass before the move. Confirm it fails when the `register(() => setServerOrigin(null))` line is removed in a scratch copy, not in the tree.
- [ ] **Step 2:** Move the code as specified. Behaviour does not change.
- [ ] **Step 3:** Check that `wc -l` shows `OnlineFeature.ts` under 300 and `main.ts` at or under 300. Then run `npx vitest run --project unit tests/unit/online tests/unit/play`, `npx tsc --noEmit` and `npm run lint`.
- [ ] **Step 4:** Strike line 87 of `online-followups.md`. Note in the Wave B section that the rest of `main.ts` belongs to upstream.
- [ ] **Step 5:** Commit with the message `GM: split OnlineFeature; settings tab wiring out of main.ts; test the server lifecycle`.

### Task 6: Test gaps: dock host-key menu, Remove button, guard-only relay tests (items 9a, 9b, 10)

**Files:**
- Test: `tests/unit/online/gm/dockAccess.test.ts`
- Test: `tests/unit/online/gm/onlineSettings.test.ts`
- Test: `tests/unit/relay/upgradeErrors.test.ts` (new)
- Test: `tests/unit/relay/players.gate.test.ts`

These are test-only. Any source change is a finding to report, not to make.

- [ ] **Step 1: `dockAccess.test.ts`**, `describe('the online menu on a self-hosted server')`. Import the texts from `account/accountView.ts`.
  - With `{ kind: 'host-key', set: false }`:
    - The lines hold `NO_HOST_KEY_TEXT` and the `onlineDock.setHostKey` help.
    - There are no buttons.
    - There is no `input` or `form`.
  - With `set: true` and a chosen campaign, there is a `Start online table` button that calls `does.start`, and no `Sign out`.
  - With `set: true` and outdated, `Update` stands in for Start.
  - With `set: true` and no campaign chosen, Start is disabled.
- [ ] **Step 2: `onlineSettings.test.ts`**
  - No Remove button while no key is set.
  - After Remove, the button is gone and the "paste" placeholder is back.
  - Setting a key shows the button without a whole-tab re-render (`sectionsChanged` count stays 0).
  - Switching the address back to Atlas's own server hides the row.
- [ ] **Step 3: `upgradeErrors.test.ts`**
  - Call `createSocketServer(...).upgrade(req, fakeSocket, Buffer.alloc(0))` directly. Wire it like `relayHarness.ts`. The fake is a `Duplex` with its `error` listeners removed first, as Node does.
  - Then `emit('error', new Error('ECONNRESET'))`.
  - Cover the 404 path (unknown code) and the 429 path (the 21st upgrade from one address).
  - Assert no throw, and that the socket is destroyed after it finishes.
- [ ] **Step 4: `players.gate.test.ts`**
  - On one raw socket, send five wrong-code hellos in one burst without awaiting.
  - A fresh player with a wrong code then still gets `CLOSE.wrongCode` (4011), not `CLOSE.paused`.
  - The GM receives no `gate-paused`.
- [ ] **Step 5: Prove each new relay test fails without its guard**
  - Remove the guard in a scratch copy: `socket.ts:149-150` for the upgrade test, and the `done` checks for the gate test.
  - Run the test against it, then restore the copy.
  - Keep no test that cannot be made red. If one cannot, drop it and note why in the report.
- [ ] **Step 6: Gate:** `npm run check:relay`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run --project unit`.
- [ ] **Step 7:** Strike lines 28 and 29 of `online-followups.md`.
- [ ] **Step 8:** Commit with the message `Tests: dock host-key menu, Remove button, relay upgrade errors and the done guard`.

## Rulings in this plan

- **`main.ts`**
  - Ruling: only the fork's settings-tab wiring moves out.
  - Why: upstream's own `main.ts` is already 308 lines, and splitting upstream code would conflict with every upstream edit.
  - Cost if wrong: `main.ts` stays a little over 300 lines.
- **Retitle in place, not withdraw-and-rebuild**
  - Ruling: a renamed note's title is updated in place.
  - Why: the note's own title is not in its copy, so updating it shows nothing new, and in place avoids a flicker.
  - Cost if wrong: one extra list message per rename.
- **Map retry**
  - Ruling: 10 s doubling, capped at 5 minutes, at most 8 attempts.
  - Why: about 20 minutes of trying is enough for a GM to fix a missing image, and a reconnect or scene change restarts it.
- **The `.atlas-play-reason` style**
  - Ruling: it gets no unit test (CSS only).
  - Why: the recon found no competing rule.
