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
