# Self-hosted online play: follow-ups after Plan 1

Deferred minor findings from the task and whole-branch reviews of Plan 1
(`docs/superpowers/plans/2026-10-26-self-hosted-online-plan-1.md`). None blocks
Plan 2; pick them up when touching the code nearby.

## Relay (`apps/relay`)
- Re-POST while the state write fails kicks the live GM, then answers 503 (`http.ts`, `tables.ts`): `replaced` fires before `flush()`. Rare; the GM retries.
- Oversize `POST /api/tables` body resets the connection instead of answering 400 (`http.ts`).
- `/api/me` has only the host-key lockout, no per-minute limit.
- Static serving follows symlinks inside `STATIC_DIR` (operator-controlled); use `realpath` to be strict.
- `persist.ts` does not guard `__proto__` ids or codes when reading its own state file.
- Newcomer limit is per client address: players behind one NAT share 10 newcomers per 10 minutes (keys and seat codes are not limited).
- The 5-wrong-code pause is triggerable by anyone with the table link and blocks seat-code re-entry for 10 minutes (keys still enter); accepted trade-off.
- Known-player records may exceed 128 if roster plus connected players exceed it.
- No relay-wide memory budget across sockets: each socket may queue up to `maxBacklogBytes` (96 MiB), so many stuck sockets add up (`routing.ts`).
- Queued outbound data is not freed eagerly when a socket closes; it waits for the outbox to be garbage collected with the socket (`routing.ts`).
- The relay's close frame can overtake frames still queued in the per-socket outbox, so a closing player may miss its last frames (`routing.ts`, `socket.ts`).

## Plugin (`src/app/online`)
- `OnlineControl.ts` is about 390 lines (over the ~300 guideline); extract the start / stray-table logic.
- `knockStack.ts`: `NAME` constant sits between imports; `inviteQr.ts` trailing piece class; `aroundToken` drops the name if a translator drops the placeholder (covered by the placeholder test).

## Tests
- `tests/unit/relay/players.test.ts` is over 300 lines; split.
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
- Large uploads: a `415` or `507` answered mid-stream may reset the connection instead of showing a status (`apps/relay/src/assets`); the GM then sends chunks.
- A relay that is full or has under 2 GiB of disk (`507`) sends everything over the socket instead.
- Minted tickets are kept in memory until the table closes (`AssetTickets.minted` is never pruned); one table with thousands of images over a very long session grows slowly.
- A lit scene whose lighting is switched off in Atlas (`lighting.enabled: false`) never shows to players (placeholder; fail closed). If Pixi's `app.init` fails (no WebGL at all) or the engine cannot start, the page stays on "Preparing lighting…" with no way out until the probe or the crash guard decides (a failed `app.init` leaves it there for good); after a crash loop the lighting stays blocked for 10 minutes.
- The tokens are drawn whole under the lighting layer: bars and nameplates dim with their token, and the map's colour is not given to the engine, so bounce light reads mid grey.
- A press on a token while the game is paused (or while the token is held) is a dead press: it neither drags nor pans the camera.
- Moving a token near a lit room edge relies on the GM's landing; there is no wall pre-check on the player's side, so a drop into a wall is shown at its cell for a moment until the GM refuses it.
- The touch `lostpointercapture` cancel and the square-grid snap offset were not checked on a real phone (M6 phone test).
- Banner contrast in dark mode and the "paused" colour are untested on small screens.
- `OnlineTable` has 11 positional constructor parameters and is about 390 lines; the pause wiring there is tested only through `PauseShare`.

## Plan 3 residuals (shared notes)
Deferred minors from the notes work; none lets hidden text reach a player.
- `obsidianSyntax.ts` is 323 lines and has duplicated comment loops.
- `parseNote` adversarial cases are not pinned by tests.
- An image's alt text is compared raw against the decoded path.
- The broken-`[[` drop works per text node.
- `ref.hash` is not checked as hex at the copy boundary.
- No test covers batching together with `dropTagged`.
- Dependents are withdrawn on any link-key change, so a linked note can flicker out of the list.
- Failed markers are kept until the next edit, and a transient read error keeps a note withdrawn until its next edit.
- `NotesShare.ts` is 319 lines and `OnlineTable.ts` about 417.
- `leave()` clearing the notes is not pinned by a test.
- An empty-title known callout shows no title.
- The settings row name "How notes are shared" was chosen without spec text.
