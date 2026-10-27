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
- `normalizeServerOrigin` accepts `http://` for any host; the host key then travels in clear text. Consider a warning for non-loopback `http:`.
- `protocol/diagnostics.ts` `feedbackNote()` is unused and duplicated by `onlineDock.feedback.*` keys.
- Feedback texts mention "the Atlas team", wrong on a self-hosted server.
- `OnlineControl.ts` is about 390 lines (over the ~300 guideline); extract the start / stray-table logic.
- On a self-hosted server the settings show both an "Online account" row ("Host key set") and the "Host key" row.
- zh polish: `请求{button}` spacing, `由 你 发现`, `线上玩家` -> `联机玩家`; add 悄悄话, 讨论串, 中转服务器 to `zh-glossary.md`.
- `knockStack.ts`: `NAME` constant sits between imports; `inviteQr.ts` trailing piece class; `aroundToken` drops the name if a translator drops the placeholder (covered by the placeholder test).

## Tests
- `tests/unit/relay/players.test.ts` is over 300 lines; split.
- Conformance ping test sends its own ping (the client's `Pulse` timer is not exercised); private `socket` field reached by a cast; no negative conformance case.
- End-to-end test: count calls on the `http` stub and assert 0; no test of an `Origin` with an explicit `:443`.
- No tests for the dock host-key menu, the Remove button, or apply-on-load / reset-on-unload.
- Guard-only tests (pass with or without the fix): the 429-cap upgrade reset, the `done` flag.

## Player app (`apps/play`)
- A stretched map (`GridState.mapStretch`) is not shared, so players see it unstretched (upstream protocol limit).
- Lit scenes show a placeholder until Plan 2b; `drag-token` is recognised but does nothing yet.
- The node end-to-end test has no Pixi view, so it drives the map request through `mapRequest` + `assets.load` and checks the GM serves nothing for a lit scene; the drawing itself is covered by the browser test (red map pixel, token art requested, under the CSP). Not covered: fog operations, pins and annotations drawn in a real browser.
- The end-to-end test fakes Atlas's player settings (`getLocalPlayerViewSettings`) and wires Atlas's real `DiceTool` into the fake tab; if Atlas's plugin surface changes, `tests/unit/play/endToEnd.test.ts` is the place that breaks first.
- The Chromium launch args (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`) are kept so Pixi gets WebGL on machines without a GPU; the test also passed without them on the development Mac.
- Render on change via the shared `RenderScheduler` instead of a continuous ticker (battery); a 100 ms idle input interval.
- The main chunk is about 542 kB (all locales): split it for mainland mobile networks.
- No open timeout (10 s) and no dead-socket check while waiting for the first frame; no `visibilitychange` / `online` hook to reconnect promptly after a phone wakes.
- Tokens outside the map rect are not covered by the fog sprite (including the whole-map cover for invalid fog).
- CSP `connect-src 'self'` against older iOS Safari (CSP3 `ws:` matching): check on the M6 phone test.
- Other players see a content-free "secret roll" line for gm/blind/self rolls (upstream behaviour; it reveals that a hidden roll happened).
- Deferred minors from the per-task reviews: close-reason test weakness, unused `now` option, unguarded second welcome, part-to-yourCode routing, hash-only download keys, `blobCache` `forget()` not closing, no GPU destroy test, card stays open over a fogged own token, `JSON.stringify(ui)` per sync, condition icon letters, badges / pin-found not drawn, row `key=index`, `rollRefusal` only in the dice tab, tab `aria-controls`, `BlobPart` cast, composer draft lost on tab switch, e2e `serve()` port race, roll count by JSON substring and a fixed sleep, swiftshader args, `endToEnd.test.ts` size.
- Token and initiative art that fails while the table is unreachable is not asked for again until the token list changes (only the map download retries).
