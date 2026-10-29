# Self-hosted online play: follow-ups after Plan 1

Deferred minor findings from the task and whole-branch reviews of Plan 1
(`docs/superpowers/plans/2026-10-26-self-hosted-online-plan-1.md`). None blocks
Plan 2; pick them up when touching the code nearby.

## Relay (`apps/relay`)
- ~~Re-POST while the state write fails kicks the live GM, then answers 503 (`http.ts`, `tables.ts`): `replaced` fires before `flush()`. Rare; the GM retries.~~ (done: a failed write rolls back before the live GM is touched; wave C)
- ~~Oversize `POST /api/tables` body resets the connection instead of answering 400 (`http.ts`).~~ (done: answers 413; wave C)
- ~~`/api/me` has only the host-key lockout, no per-minute limit.~~ (done: per-minute limit added; wave C)
- ~~Static serving follows symlinks inside `STATIC_DIR` (operator-controlled); use `realpath` to be strict.~~ (done: root and entries are checked with `realpath`, dotfiles through symlinks refused; wave C)
- ~~`persist.ts` does not guard `__proto__` ids or codes when reading its own state file.~~ (done: guarded when reading the state file; wave C)
- Newcomer limit is per client address: players behind one NAT share 10 newcomers per 10 minutes (keys and seat codes are not limited).
- The 5-wrong-code pause is triggerable by anyone with the table link and blocks seat-code re-entry for 10 minutes (keys still enter); accepted trade-off.
- ~~Known-player records may exceed 128 if roster plus connected players exceed it.~~ (done: resolved by an invariant, the roster cap holds; wave C)
- ~~No relay-wide memory budget across sockets: each socket may queue up to `maxBacklogBytes` (96 MiB), so many stuck sockets add up (`routing.ts`).~~ (done: one 256 MiB budget across sockets, the largest backlog is closed with 1013; wave C)
- ~~Queued outbound data is not freed eagerly when a socket closes; it waits for the outbox to be garbage collected with the socket (`routing.ts`).~~ (done: the outbox is dropped when the socket closes; wave C)
- ~~The relay's close frame can overtake frames still queued in the per-socket outbox, so a closing player may miss its last frames (`routing.ts`, `socket.ts`).~~ (done: close waits for the outbox to flush; wave C)

## Plugin (`src/app/online`)
- ~~`OnlineControl.ts` is about 390 lines (over the ~300 guideline); extract the start / stray-table logic~~ (done: start, events and tokens split out; 296 lines).
- ~~`knockStack.ts`: `NAME` constant sits between imports~~ (done). `inviteQr.ts` trailing piece class; `aroundToken` drops the name if a translator drops the placeholder (covered by the placeholder test).

## Tests
- ~~`tests/unit/relay/players.test.ts` is over 300 lines; split~~ (done: `players.gate`, `.routing`, `.persistence` and `.limits` test files plus the `tableSuite.ts` helper, 180 relay tests as before, each file under 140 lines).
- Conformance ping test sends its own ping (the client's `Pulse` timer is not exercised); private `socket` field reached by a cast; no negative conformance case.
- End-to-end test: count calls on the `http` stub and assert 0; no test of an `Origin` with an explicit `:443`.
- No tests for the dock host-key menu, the Remove button, or apply-on-load / reset-on-unload.
- Guard-only tests (pass with or without the fix): the 429-cap upgrade reset, the `done` flag.

## Player app (`apps/play`)
- A stretched map (`GridState.mapStretch`) is not shared, so players see it unstretched (upstream protocol limit).
- Lit scenes and own-token drags came with Plan 2b (see "Plan 2b residuals").
- The node end-to-end test has no Pixi view, so it drives the map request through `mapRequest` + `assets.load` and checks the GM serves nothing for a lit scene; the drawing itself is covered by the browser test (red map pixel, token art requested, under the CSP). Not covered: fog operations, pins and annotations drawn in a real browser.
- The end-to-end test fakes Atlas's player settings (`getLocalPlayerViewSettings`) and wires Atlas's real `DiceTool` into the fake tab; if Atlas's plugin surface changes, `tests/unit/play/endToEnd.test.ts` is the place that breaks first.
- The Chromium launch args (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`) are kept so Pixi gets WebGL on machines without a GPU; the test also passed without them on the development Mac.
- Render on change via the shared `RenderScheduler` instead of a continuous ticker (battery); a 100 ms idle input interval.
- ~~No open timeout (10 s) and no dead-socket check while waiting for the first frame~~ (done: `OPEN_TIMEOUT_MS`).
- ~~No `visibilitychange` / `online` hook to reconnect promptly after a phone wakes~~ (done: `TableSocket.wake()`, called by `Session`).
- Tokens outside the map rect are not covered by the fog sprite (including the whole-map cover for invalid fog).
- CSP `connect-src 'self'` against older iOS Safari (CSP3 `ws:` matching): check on the M6 phone test.
- Other players see a content-free "secret roll" line for gm/blind/self rolls (upstream behaviour; it reveals that a hidden roll happened).
- Deferred minors from the per-task reviews: close-reason test weakness, unused `now` option, unguarded second welcome, part-to-yourCode routing, hash-only download keys, `blobCache` `forget()` not closing, no GPU destroy test, card stays open over a fogged own token, `JSON.stringify(ui)` per sync, condition icon letters, badges / pin-found not drawn, row `key=index`, `rollRefusal` only in the dice tab, tab `aria-controls`, `BlobPart` cast, composer draft lost on tab switch, e2e `serve()` port race, roll count by JSON substring and a fixed sleep, swiftshader args, `endToEnd.test.ts` size.
- The `OnlineTable` wiring of fork levels (`forkClients.forget` on `left`, a `client` after a GM re-welcome) is tested only through `ForkClients` and the Node end-to-end test, not through `OnlineTable` itself (no harness).
- `.atlas-play-reason` is styled only inside `.atlas-play-join`; the send-failed notice, the dice tray refusal and the refused screen show it unstyled.
- `SceneView.sync` calls `coarsePointer()` (`matchMedia`) on every store update; evaluate it once.
- `MapDownload` retries a map the GM never serves every 10 s without an upper bound (rate-limited, stops on scene change, lit scene or destroy).

## Plan 2b residuals (image cache, lit scenes, drags, pause)
What a user could notice; the rest of the deferred minors are in the SDD ledger.
- A slow phone whose `cache.put` runs past the 10 s stall window after a good ticket can show the "Image sent by the GM directly" line and fetch the image twice (`AssetLoader`).
- The fallback line is a local log entry ordered by the phone's clock, so it can sit slightly out of order among the GM's entries.
- ~~Large uploads: a `415` or `507` answered mid-stream may reset the connection instead of showing a status (`apps/relay/src/assets`); the GM then sends chunks.~~ (done: refusals are answered, then drained or closed; wave C)
- A relay that is full or has under 2 GiB of disk (`507`) sends everything over the socket instead.
- ~~Minted tickets are kept in memory until the table closes (`AssetTickets.minted` is never pruned); one table with thousands of images over a very long session grows slowly.~~ (done: `minted`, `failed` and `mintRests` keep about 256 entries, oldest first; wave C)
- A lit scene whose lighting is switched off in Atlas (`lighting.enabled: false`) never shows to players (placeholder; fail closed). If Pixi's `app.init` fails (no WebGL at all) or the engine cannot start, the page stays on "Preparing lighting…" with no way out until the probe or the crash guard decides (a failed `app.init` leaves it there for good); after a crash loop the lighting stays blocked for 10 minutes.
- The tokens are drawn whole under the lighting layer: bars and nameplates dim with their token, and the map's colour is not given to the engine, so bounce light reads mid grey.
- After a reconnect, a lit scene's explored mask is not asked for again (it is fetched once per reference). It fails closed: the player sees less, not more, until the explored memory changes (a new hash) or the scene is loaded again.
- ~~A press on a token while the game is paused (or while the token is held) is a dead press: it neither drags nor pans the camera.~~ (done: `canDrag` decides drag and camera together; wave D)
- A pause or hold that arrives mid-drag keeps the camera still until release (the drag is cancelled, the camera is given back only on the release).
- Moving a token near a lit room edge relies on the GM's landing; there is no wall pre-check on the player's side, so a drop into a wall is shown at its cell for a moment until the GM refuses it.
- The touch `lostpointercapture` cancel and the square-grid snap offset were not checked on a real phone (M6 phone test).
- Banner contrast in dark mode and the "paused" colour are untested on small screens.
- ~~`OnlineTable` has 11 positional constructor parameters and was about 430 lines~~ (done: one options object, 298 lines). The pause wiring there is tested only through `PauseShare`.

## Plan 3 residuals (shared notes)
Deferred minors from the notes work; none lets hidden text reach a player.
- ~~`obsidianSyntax.ts` is 323 lines and has duplicated comment loops~~ (done: split and deduped, now 25 lines).
- ~~`parseNote` adversarial cases are not pinned by tests~~ (done: pinned; an unclosed inline `<!--` now cuts the copy).
- ~~An image's alt text is compared raw against the decoded path~~ (done: alt text vs file name is compared decoded).
- ~~The broken-`[[` drop works per text node~~ (done).
- ~~`ref.hash` is not checked as hex at the copy boundary~~ (done).
- ~~No test covers batching together with `dropTagged`~~ (done: pinned).
- ~~Dependents are withdrawn on any link-key change, so a linked note can flicker out of the list~~ (done: dependents stay listed).
- ~~Failed markers are kept until the next edit, and a transient read error keeps a note withdrawn until its next edit~~ (done: bounded retry at 2 s, 10 s and 60 s).
- ~~`NotesShare.ts` was 319 lines and `OnlineTable.ts` about 430~~ (done: 294 and 298 lines).
- ~~`leave()` clearing the notes is not pinned by a test~~ (done: pinned).
- ~~An empty-title known callout shows no title~~ (done: shows the type as its default title).
- The settings row name "How notes are shared" was chosen without spec text.
- ~~The online settings did not show on Obsidian 1.13+ until reopened~~ (done: settings refresh, found in testing).
- ~~The community store replaced a fork installed as `atlas-vtt`~~ (done: local installs use the plugin id `atlas-vtt-fork`; found in testing). True only since the wave B final fix: online play used to look Atlas up under the fixed id `atlas-vtt`, and now reads the running plugin's `manifest.id` (`src/app/plugin/pluginId.ts`).

## Wave B residuals (open)
- Renaming a shared note's title lags: the list shows the old title until the next change.
- An escaped `\<!--` in a note cuts the copy there although it is only text (known over-hide; fails closed, pinned in `playerCopy.test.ts`).
- The settings page re-renders when the server address changes, which can drop focus in the field.
- The `-fork` version suffix silences the upstream update notice and the changelog's release matching (intended; written in FORK_GUIDE).
- `main.ts` (316 lines) and `OnlineFeature.ts` (356 lines) are over the ~300 line guideline.

## Wave C residuals (open)
Deferred minors from the relay hardening wave and the ticket pruning; the SDD ledger has the detail.
- Overlapping failed re-POSTs: the rollback of the first can interfere with the second (fix later by serialising `createDurable` per code).
- `readBody` hangs only for a client that stays connected but sends nothing; the 300 s `requestTimeout` ends it.
- The relay-wide backlog budget does not count bytes already handed to ws (in flight, about 1.3 MiB per socket at most).
- Minting past the oversize limit is not covered by a test.
- `MeRateLimit` behind a proxy (`TRUST_PROXY=cf`) is not covered by a test.
- Upload resume of an already complete image (`200`) is not bounded by the drain limit, and the `writePart` reject path is not covered.
- The test "closes the largest backlog" depends on loopback buffering; a fake-socket version would be steadier.
- `AssetTickets.uploaded` (hashes known to be in the relay's cache) is still not pruned; it holds only hashes, about 64 bytes each.
- The `AssetTickets.mintRests` cap is soft: a rest still inside its 60 s is never dropped, so more than 256 hashes refused within one minute are all kept until their rests end.
- `TableRegistry.createDurable` puts the new secret in memory before the flush: during it a GM hello with the new secret is accepted or the old GM's reconnect is refused, and a failed flush rolls back to a GM socket whose secret no longer validates. Fix: check secrets against the committed record until the flush resolves.
- Deploying wave C to the VPS needs the user's go-ahead and has not been done.
