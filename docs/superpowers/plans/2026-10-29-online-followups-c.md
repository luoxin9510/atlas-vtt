# Online follow-ups, wave C (relay hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the public relay (play.xinsawi.com) against failure and abuse cases from `docs/fork/online-followups.md`: a GM kicked by a failed write, connections reset instead of answered, unbounded memory across sockets, close frames overtaking data, symlink and prototype tricks, and missing server timeouts. The wire contract does not change.

**Architecture:** Server-side changes in `apps/relay/src/` plus one plugin-side cleanup (`AssetTickets`). Every fix lands with a test in `tests/unit/relay/` that runs against the real relay through the existing harnesses (`relayHarness.ts`, `playerHarness.ts`, `tableSuite.ts`).

**Tech Stack:** Node ≥ 22.18 (native TypeScript), `ws`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (relay sections); contract `docs/fork/online-contract.md`. Measured behaviour, line references and proposals: `.superpowers/sdd/2026-10-29-online-followups-c/recon-wave-c.md` (item numbers below are its numbers). Base: `feature/online-followups-b` + 3c933da2.

## Global Constraints

- No wire contract change: the same paths, status codes, close codes and frames, so the deployed GM plugin and player app keep working. Close code 1013 (retry later) is already retryable for both clients.
- The relay logs request lines and close codes only, never keys, tickets, table secrets or bodies.
- Relay files stay under about 300 lines. New upload tests go in a new file, because `assetUpload.test.ts` is already 373 lines.
- Explicit return types. No `eslint-disable` or `ts-ignore`. ESLint ignores `apps/`, so `npm run check:relay` is the type gate there.
- Gate per task: `npm run check:relay`, `npx tsc --noEmit`, `npx vitest run --project unit tests/unit/relay`. Task 6 also runs `tests/unit/online` and `npm run lint`.
- Run tests in the foreground. Never `npm run build`. Never touch `dev-vault` or the VPS.
- Commit trailers: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01VhBMZn91fCVnzp544cpjN3`.

## Review Focus

1. **A GM re-creating its table while the state disk is full or read-only:** the live GM must stay connected and get a clean 503. No table slot may leak.
2. **A player on a slow phone link during a large map broadcast:** the relay-wide budget must close the biggest laggard with 1013 and never the GM first. Shared broadcast payloads are counted once.
3. **A table ending while frames are still queued:** players receive the queued frames before the close frame, or the close follows within the 5 s cap.
4. **An oversize or refused upload or POST:** the client sees the status (400/413/415/507), not a reset. Draining is bounded (16 MiB or 10 s).
5. **A slow or idle connection (slowloris, many sockets):** header and request timeouts and `maxConnections` cut it off. Nothing the relay serves follows a symlink out of `STATIC_DIR` or serves a dotfile.

---

### Task 1: HTTP answers and table creation (items 1, 2, 3)

**Files:** `apps/relay/src/tables.ts`, `apps/relay/src/http.ts`, `apps/relay/src/httpUtil.ts`, `apps/relay/src/limits.ts`; tests in `tests/unit/relay/` (a new `httpAnswers.test.ts`, or the existing table/http test file if it stays under 300 lines).

**Interfaces:**
- `createDurable(...)` in `tables.ts`: makes or replaces the table, writes the state, and only then notifies (`replaced`). If the write fails, it rolls back to the previous table and returns failure. No slot leaks.
- `readBody` in `httpUtil.ts` answers 400 (malformed) or 413 (too large) before closing. It never calls `req.destroy()` before the response is written.
- `MeRateLimit` in `limits.ts`: 60 requests per minute per client address on `/api/me`, answered with 429.

- [ ] **Step 1: Failing tests (recon 1-3 (d)).**
  - A re-POST while the state write fails keeps the live GM's socket open and answers 503. A failed first POST leaves no table counted.
  - An oversize `POST /api/tables` gets a 4xx response that the client can read (no ECONNRESET/EPIPE).
  - The 61st `/api/me` within a minute gets 429.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run the gate.
- [ ] **Step 4:** Commit: `Relay: keep the GM on a failed re-create; answer oversize bodies; limit /api/me`.

### Task 2: State file and static serving (items 4, 5, 6, plus static fixes from 12)

**Files:** `apps/relay/src/persist.ts`, `apps/relay/src/static.ts`, `apps/relay/src/main.ts` or `server.ts` (startup `realpath`); tests.

- [ ] **Step 1: Failing tests:**
  - A state file holding a `__proto__` table code or player id loads without that entry, and `Object.prototype` is untouched. Keys are validated against `TABLE_CODE_PATTERN` and `PLAYER_ID_PATTERN`.
  - A symlink inside `STATIC_DIR` that points outside it answers 404.
  - A dotfile (`.env`, `.git/…`) answers 404.
  - A client that aborts mid-download leaves no open file descriptor (use `pipeline`).
  - Pin the item-6 invariant: `MAX_CAMPAIGN_PLAYERS + MAX_CONNECTED_PLAYERS ≤ KNOWN_PLAYER_CAP`, using the real constant names.
- [ ] **Step 2:** Implement.
  - `realpath` the static root once at startup.
  - Then do one `realpath` per request, and refuse anything that does not resolve inside the root.
  - Swap `.pipe` for `stream.pipeline`.
- [ ] **Step 3:** Run the gate.
- [ ] **Step 4:** Commit: `Relay: validate state keys; serve no symlinks or dotfiles`.

### Task 3: Outbox lifecycle and a relay-wide memory budget (items 8, 9, 7, in that order)

**Files:** `apps/relay/src/routing.ts`, `apps/relay/src/socket.ts`, `apps/relay/src/gmLink.ts`, `apps/relay/src/playerLink.ts`, new `apps/relay/src/backlog.ts`; tests in a new `tests/unit/relay/backlog.test.ts`.

**Interfaces** (names from recon 7-9; adjust to fit the code, but keep the behaviour exact):
- `dropOutbox(socket)`: called on close; frees queued data at once.
- `queuedBytes(socket): number`.
- `closeWhenSent(socket, code, reason)`: sends the close frame only after the queued frames have flushed, or after `CLOSE_FLUSH_MS = 5_000`, whichever comes first.
- `backlog.ts` holds `RELAY_BACKLOG_BUDGET = 256 * 1024 * 1024`.
  - It counts distinct payloads by reference: a broadcast string shared by many sockets counts once, released when its last holder sends or drops it.
  - When the total exceeds the budget, it closes the socket with the largest backlog, players before the GM, with code 1013.

- [ ] **Step 1: Failing tests:**
  - a closed socket's queue is freed (its bytes leave the total);
  - a table end sends queued frames before the close, and closes within 5 s when the peer does not read;
  - one 85 MiB broadcast to 8 players counts 85 MiB, not 680;
  - over the budget, the player with the largest backlog is closed with 1013, and the GM stays connected while any player can be closed.
- [ ] **Step 2:** Implement in the order 8 → 9 → 7, keeping each step's tests green before starting the next.
- [ ] **Step 3:** Run the gate. The whole `tests/unit/relay` folder and `tests/unit/play/endToEnd.test.ts` must pass, since the latter goes through the real relay.
- [ ] **Step 4:** Commit: `Relay: free closed outboxes, close after flushing, budget memory across sockets`.

### Task 4: Refused uploads show their status (item 10)

**Files:** `apps/relay/src/assets/*.ts`, `apps/relay/src/httpUtil.ts`; new test file `tests/unit/relay/assetRefusal.test.ts`.

- [ ] **Step 1: Failing test.** A Node client streaming a body that is refused with 415 or 507 before the body is read gets that status, with no EPIPE or ECONNRESET.
- [ ] **Step 2:** Implement. Answer first, then drain the rest of the body. Draining is bounded by `REFUSED_DRAIN_BYTES = 16 * 1024 * 1024` and `REFUSED_DRAIN_MS = 10_000`; past either bound, destroy the request. A drained body is never written anywhere.
- [ ] **Step 3:** Run the gate.
- [ ] **Step 4:** Commit: `Relay: answer refused uploads before closing`.

### Task 5: Server limits and process safety (item 12)

**Files:** `apps/relay/src/server.ts`, `apps/relay/src/main.ts`, `apps/relay/README.md`, `docs/fork/deployment.md` (one paragraph); tests.

- [ ] **Step 1: Failing tests:**
  - the server is created with `headersTimeout = 20_000`, `requestTimeout = 300_000`, `keepAliveTimeout = 95_000` (above cloudflared's 90 s idle keep-alive) and `maxConnections = 512`;
  - a connection that sends headers slowly is closed after `headersTimeout` (test with a small override);
  - the uncaught error handler logs one line (no body, no secret) and exits non-zero, so systemd restarts the relay.
- [ ] **Step 2:** Implement. Make the values constants that a test can override; do not add new environment variables.
- [ ] **Step 3:** Run the gate.
- [ ] **Step 4:** Commit: `Relay: server timeouts, connection cap, crash handler`.

### Task 6: Prune GM-side upload tickets (item 11)

**Files:** `src/app/online/gm/assetUpload/AssetTickets.ts`; its test.

- [ ] **Step 1: Failing test.** After `ASSET_TICKET_CAP = 256` distinct hashes, the oldest `minted`, `failed` and `mintRests` entries are dropped. A dropped hash is minted again on its next use (a fresh ticket); it is not refused.
- [ ] **Step 2:** Implement `prune()`, called after each insert.
- [ ] **Step 3:** Run `npx vitest run --project unit tests/unit/online`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 4:** Update `docs/fork/online-followups.md`: strike every item this wave closed, the same way earlier items were struck.
- [ ] **Step 5:** Commit: `GM: prune upload tickets; update follow-ups`.

## Rulings in this plan

- The budget is 256 MiB across distinct payloads. The VPS has 4 GB of RAM shared with xray, Audiobookshelf and pi-web. A broadcast map is about 85 MiB, so three of them in flight fit.
- Code 1013 is used for both the budget close and the existing per-socket backlog close, so no client change is needed.
- `/api/me` is limited even though the self-hosted plugin never calls it. It is public and costs a host-key compare.
- No new environment variables: the limits are constants. An operator who needs other values edits the code, which keeps `relay.env` minimal.
- Deploying this wave to the VPS is a separate step that needs the user's go-ahead.
