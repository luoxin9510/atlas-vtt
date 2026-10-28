# Self-hosted online play, Plan 2b (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players see lit scenes through the shared lighting engine (or a placeholder, never the unlit map), drag their own tokens, download images from the server's image cache with the socket as fallback, and see when the GM has paused the game.

**Architecture:** Three independent strands meet in `apps/play`. (1) Fork protocol level 2 adds `pause`, `asset-ticket` and the `paused` refusal; the GM client gains a persisted pause switch and an image uploader. (2) The relay gains an on-disk image store with table-secret uploads, server-minted HMAC tickets and ticketed downloads. (3) The player app adapts `lighting` / `sight` / `explored` into the state the shared `LightingRenderer` reads, probes float render targets first, and gains a drag controller over the existing gesture recogniser.

**Tech Stack:** TypeScript, PixiJS 8.22.0, pixi-viewport 6, React 19.3.1, zustand 5, vitest 4 (unit / gpu / play-e2e projects), Node >= 22.18 (`node:crypto`, `node:fs/promises` `statfs`), Obsidian `requestUrl` (binary `ArrayBuffer` body).

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (section 2 G3b, G4, G8, G10; 6.3; 6.3a; 6.7; 8). Contract: `docs/fork/online-contract.md`. Plan 2a (`docs/superpowers/plans/2026-10-26-self-hosted-online-plan-2a.md`) built `apps/play`; its residuals are in `docs/fork/online-followups.md`.

## Global Constraints

- Anti-goal: nothing the GM hides reaches a player. A lit scene shows the map only once the lighting engine has drawn current sight over it; before that, and whenever the probe fails, the engine reports `onUnavailable`, the WebGL context is lost or a crash-loop guard trips, the app shows the placeholder and draws no map pixel (fail closed, G3b). No ticket, no image: the relay serves image bytes only for a valid GM-issued ticket.
- Fork protocol: `FORK_PROTOCOL_LEVEL = 2`. Messages new in level 2 (`pause`, `asset-ticket`) are sent only to players whose recorded level is `>= 2` (an explicit `2`, never `FORK_PROTOCOL_LEVEL`). Level-0 players get no `pause` and just see `move-refused` without a reason they understand.
- Pause (6.3a): kept in `SavedTable.paused`; while paused the GM refuses every player `move` with `move-refused {reason:'paused', x, y}` (token's current place) before the rate limit; `drag` and `drag-cancel` are ignored without answers; turning pause on ends every live player drag `'back'` (other screens get `live … end:true`). Player text "游戏已暂停 / Game paused".
- Image cache routes (exact): `PUT /api/tables/{code}/assets/{sha256}/parts/{index}`, `POST /api/tables/{code}/assets/{sha256}/complete`, `GET /api/tables/{code}/assets/{sha256}` (resume status), `POST /api/tables/{code}/assets/{sha256}/tickets` (mint), all with `Authorization: Bearer <table secret>`, no `Origin` check; `GET /api/assets/{sha256}?t=<code>.<player id>.<expiry>.<mac>` (download).
- Image cache values: part size 8 MiB (8 388 608 bytes), total ≤ `MAX_ASSET_BYTES` (64 MiB), so part index 0..7; types PNG, JPEG, WebP, GIF, AVIF by magic bytes only; per table at most 2 uploads in flight and 4 unfinished, 2 GiB stored; per server 10 GiB stored and ≥ 2 GiB free disk, else `507`; 60 upload-route requests per minute per client address, else `429`; unfinished parts deleted after 1 hour; tickets valid 120 s; signing key 32 random bytes in the relay state file; MAC = base64url HMAC-SHA-256 over `code`, `player`, `hash`, `expiry` joined by `\n`; expired tickets rejected before the MAC; MAC compared with `timingSafeEqual` after a length check.
- Download response headers (exact): sniffed `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`. A bad, expired or forged ticket and an unknown hash answer the same `404` with the same body.
- Secrets: tickets, table secrets, the host key and the signing key never reach a log line; the relay logs path only (never the query). No game body is logged.
- The binary upload module (`src/app/online/gm/assetUpload/binaryHttp.ts`) is the only new file that calls `requestUrl(` or writes a `Bearer` header; `tests/unit/online/noKeys.test.ts` allowlists exactly it.
- Player frames: at most 20 per second reach the relay (4005 above), so the app sends `drag` at most every 100 ms; every frame ≤ 4 KiB.
- Player fallback line (exact, through `t()`): "图片改由主持人直接发送 / Image sent by the GM directly", shown once per image.
- Upstream conventions (`docs/fork/FORK_GUIDE.md`): explicit return types, no `any`, no inline eslint-disable / ts-ignore, files under ~300 lines (split `SceneView.ts` and `AssetLoader.ts` rather than grow them), UI text through `t()` with keys in `locales/en/` and `locales/zh/` (`onlinePlay.*` for the app, `onlineDock.*` for the GM dock), Chinese per `docs/fork/zh-glossary.md`; PixiJS v8 only (check current v8 docs before Pixi code). After every task: `npx tsc --noEmit`, `npm run check:play`, `npm run check:relay`, `npm run check:boundaries`, `npm run lint`, `npx vitest run --project unit` green; tasks touching `apps/play` also `npm run build:play`.
- `apps/play` imports only the `shared` and `play` boundary groups. `LightingRenderer`, `ExploredMemory`, `pixi/lighting/engine/**`, `vision/**`, `lighting/**`, `token-renderer/SensedOutlines.ts` are shared; `createSceneLighting.ts`, `SessionLighting.ts`, `LightingViewHost.ts`, `CanvasLightingFallback.ts` are not and are not added.
- Tests: player tests in `tests/unit/play/`, GM in `tests/unit/online/`, relay in `tests/unit/relay/`, Chromium pixel tests in `tests/gpu/` (local only), browser end-to-end in `tests/e2e/` (`npm run test:play-e2e`).

## Review Focus

1. A lit scene whose lighting is not ready yet, whose probe fails, or whose GPU context is lost mid-game: no unlit map pixel is ever on screen (Task 8 tests `keeps the map hidden until sight is current`, `falls back to the placeholder on context loss`).
2. A ticket that expires or fails to download (slow phone, proxy error): the app falls back to socket chunks exactly once for that image and shows the log line once, never loops (Task 6 test `falls back once on a failed ticket`).
3. The GM reloads Obsidian while paused, and a player joins or reconnects while paused: pause survives the reload and reaches every level-2 player after their `client` message (Task 2 tests `keeps pause across a reload`, `sends pause after a client message`).
4. The relay restarts: the signing key and stored images survive, a save of the table list keeps the key, and a table's images go when the table ends (Task 3 tests `keeps the ticket key across saves`, `deletes images when a table ends`).
5. An own-token drag interrupted by a second finger, `pointercancel`, a refusal or a socket drop: the app sends `drag-cancel` (when connected), the token returns to the list's place, and camera drag is re-enabled (Task 9 tests).

---

### Task 1: Fork protocol level 2 (`pause`, `asset-ticket`, `paused` refusal, socket fallback)

**Files:**
- Modify: `src/app/online/protocol/fork.ts`, `game.ts` (`GmMessage`, `parseGmMessage` cases beside `your-turn`; `PlayerAssetRequest.via`; `parseAssetRequest`), `moves.ts:52-60,89-93`, `docs/fork/online-contract.md` (fork messages section, fixed `game.ts` line refs)
- Test: `tests/unit/online/protocol/fork.test.ts`, `tests/unit/online/protocol/moves.test.ts` (create if absent)

**Interfaces:**
- Produces (`fork.ts`): `FORK_PROTOCOL_LEVEL = 2` (doc comment gains "2: pause, asset-ticket, move-refused reason paused, asset-request via socket"); `export const PAUSE_LEVEL = 2`; `export interface PauseMessage { readonly t: 'pause'; readonly paused: boolean }`; `export interface AssetTicketMessage { readonly t: 'asset-ticket'; readonly hash: string; readonly url: string; readonly expires: number }`; `parsePause(value: Record<string, unknown>): PauseMessage | null`; `parseAssetTicket(value: Record<string, unknown>): AssetTicketMessage | null`; `export const TICKET_URL_PATTERN = /^\/api\/assets\/[0-9a-f]{64}\?t=[a-z2-7]{26}\.[a-z2-7]{20}\.[0-9]{1,15}\.[A-Za-z0-9_-]{43}$/` (table code = `TABLE_CODE_PATTERN` in `relay.ts:12`, player id = `PLAYER_ID_PATTERN` in `identity.ts:6`; neither contains `.`).
- Produces (`moves.ts`): `MoveRefused.reason?: 'turn' | 'paused'`; parser keeps unknown reasons as none.
- Produces (`game.ts`): `PlayerAssetRequest.via?: 'socket'` — the player asks for chunks and no ticket; parser accepts only the literal.

- [ ] **Step 1: Write the failing tests.** `fork.test.ts`: `FORK_PROTOCOL_LEVEL` is 2; `parseGmMessage({t:'pause', paused:true})` → `{t:'pause', paused:true}`; `{t:'pause'}` and `{t:'pause', paused:'yes'}` → null; a valid ticket (`hash` 64 hex, `url` = `/api/assets/<same hash>?t=<code>.<20-char id>.<ms>.<43 chars>`, `expires` integer) parses; a `url` with another hash than `hash`, an absolute `https://evil/...` url, a non-integer `expires` → null. `moves.test.ts`: `reason:'paused'` kept, `reason:'x'` dropped. `parsePlayerMessage({t:'asset-request', hash, via:'socket'})` keeps `via`; `via:'http'` → null.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/protocol`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and parsers above; `parseAssetTicket` also requires the hash inside `url` to equal `hash`. Update the contract doc's fork-message list (`client`, `your-turn`, `pause`, `asset-ticket`) and the `game.ts` line refs. Update `apps/play` callers that switch over `GmMessage` exhaustively so `check:play` stays green (ignore both new messages for now).
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Protocol: fork level 2 with pause, asset tickets and the paused refusal"`.

### Task 2: GM pause switch, refusal and re-send

**Files:**
- Create: `src/app/online/gm/PauseShare.ts`
- Modify: `gm/savedTable.ts` (`paused`), `gm/OnlineTable.ts` (hold flag, ctor arg, `client` hook), `gm/OnlineControl.ts:318-325` (`events.paused`), `gm/forkClients.ts` (`onClient`), `gm/playerMoves.ts:18-25,101-114,158-165`, `gm/playerDrags.ts:81-106` (+ `cancelAll`), `gm/sceneBinding.ts` / `SceneShare.ts` (pass `paused()` port), `gm/dock/gateRows.ts`, `OnlinePanel.ts:114-120`, `ConnectionMenu.ts:52-55`, `panelModel.ts`, `locales/{en,zh}/onlineDock.ts`
- Test: `tests/unit/online/gm/pause.test.ts`, extend `tests/unit/online/gm/savedTable.test.ts` (or the file testing `readSavedTable`)

**Interfaces:**
- Produces: `SavedTable.paused?: boolean` (read as `false` unless exactly `true`); `OnlineTable.pause: { readonly paused: boolean; set(on: boolean): void }`; `OnlineTableEvents.paused(on: boolean): void` → `keep({...saved, paused})`.
- Produces: `class PauseShare { constructor(ports: { players(): readonly string[]; levelOf(player: string): number; send(body: GmMessage, to: string): void }); set(paused: boolean): void; client(player: string): void; get paused(): boolean }` — `set` sends `{t:'pause', paused}` to every online player with level `>= PAUSE_LEVEL` when the value changes; `client(player)` sends the current value to that player when its level is `>= PAUSE_LEVEL` (also when false, so a reconnect clears a stale banner).
- Produces: `ForkClients` gains an optional `onClient?: (player: string, level: number) => void` constructor port, called after recording.
- Produces: `PlayerMovePorts.paused(): boolean`; `PlayerMoves.refuse(from, move, reason?: 'turn' | 'paused')`; `PlayerDrags.cancelAll(): void` (= `end(all live, 'back')`).
- Dock: a checked menu entry "暂停游戏 / Pause game" next to the gate entries and, while paused, a status row "游戏已暂停 / Game paused" (name it `playPaused`, the existing `paused` / `renderPausedRow` mean the join gate).

- [ ] **Step 1: Write the failing tests** (`shareHarness` with `forkLevels`): `refuses moves while paused` — paused, a `move` of an owned token → one `move-refused {reason:'paused', x, y}` with the token's current place, and the token unmoved; `refuses before the rate limit` — 20 moves in one second while paused → 20 refusals all with `reason:'paused'` (none without a reason); `ignores drags while paused` — `drag` and `drag-cancel` → nothing sent, token unmoved; `ends live drags on pause` — a player drag in progress, then pause on → the next `live` carries `end:true` for that token and it is back at its start; `sends pause to level-2 players only` — players at levels 0, 1, 2 → only the level-2 one gets `{t:'pause', paused:true}`; no message when set to the same value; `sends pause after a client message` — a level-2 `client` arriving while paused → `{t:'pause', paused:true}` to that player; `keeps pause across a reload` — `readSavedTable` round-trips `paused:true`, and an `OnlineTable` built from it starts paused.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/gm/pause.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The pause check is the first line of `PlayerMoves.receive` (before `rate.take` at :103) and of `PlayerDrags.receive` (before :83); `checkMove` stays as is. `OnlineTable` feeds `ForkClients.onClient` into `PauseShare.client` and calls `drags.cancelAll()` for every scene binding when pause turns on. The dock entry calls `table.pause.set(!paused)`; the snapshot exposes `paused`.
- [ ] **Step 4: Verify** the per-task checks, plus `npx vitest run --project unit tests/unit/online`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: pause the game for players, persisted with the saved table"`.

### Task 3: Relay image store (uploads, resume, caps, cleanup)

**Files:**
- Create: `apps/relay/src/assets/assetStore.ts` (disk layout, counters, caps), `apps/relay/src/assets/sniff.ts`, `apps/relay/src/assets/uploadRoutes.ts`
- Modify: `apps/relay/src/config.ts` (optional fields), `persist.ts` (top-level `ticketKey`), `tables.ts:21-24,41,67` (listeners become a `Set`, `subscribe` returns an unsubscribe), `http.ts:116-135` (route table-scoped asset paths before the 4 KiB body reader; no `connection: close` for them), `server.ts:21-26` (wire store), `limits.ts` (per-address `UploadRateLimit`), `apps/relay/README.md` (env table)
- Test: `tests/unit/relay/assetUpload.test.ts`, extend `tests/unit/relay/persistence.test.ts`

**Interfaces:**
- Produces (config): `assetDir?: string` (env `ASSET_DIR`, default `join(dirname(statePath), 'assets')`), `maxTableAssetBytes?: number` (2 GiB), `maxServerAssetBytes?: number` (10 GiB), `minFreeBytes?: number` (2 GiB); all optional so `relayHarness.ts` literals still compile.
- Produces (persist): `loadState(path): Promise<{ tables: Record<string, StoredTable>; ticketKey: string | null }>` and `saveState(path, state)` writing `{version:1, tables, ticketKey}` (base64url); the registry passes the key through on every save. `ensureTicketKey()` makes 32 random bytes on first start and saves once.
- Produces (`assetStore.ts`): `class AssetStore { constructor(dir: string, limits: AssetLimits, now: () => number); static open(...): Promise<AssetStore>` (scans sizes); `has(code, hash): boolean; status(code, hash): { complete: true } | { parts: number[] }; writePart(code, hash, index, body: Readable): Promise<PartResult>; complete(code, hash): Promise<CompleteResult>; open(code, hash): { stream: ReadStream; mime: string; size: number } | null; deleteTable(code): Promise<void>; sweep(): Promise<void>` }. `PartResult` / `CompleteResult` map to statuses: `200`, `413` (part over 8 MiB or total over 64 MiB, counted while streaming, the file removed), `415` (part 0 not one of the five types), `422` (SHA-256 mismatch on complete; parts removed), `429` (more than 2 in flight or 4 unfinished for the table), `507` (table 2 GiB, server 10 GiB, or `statfs` free below 2 GiB). Layout: `<dir>/<code>/<hash>` complete files, `<dir>/<code>/.parts/<hash>/<index>`.
- Produces (`sniff.ts`): `sniffImage(head: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif' | null` (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WebP `RIFF????WEBP`, AVIF `????ftypavif` / `ftypavis`).
- Routes: `PUT .../parts/{index}` → `200 {}`; `POST .../complete` → `200 {hash}`, or `200 {hash}` at once when held (idempotent); `GET .../assets/{hash}` → `200 {complete:true}` or `200 {parts:[...]}`; every route checks `tables.checkSecret(code, bearer)` first (`401` same body otherwise) and the per-address limit (60/min). Table end (`TableRegistry` listener `ended`) → `deleteTable`. `sweep` runs every 10 minutes and removes part folders older than 1 hour.

- [ ] **Step 1: Write the failing tests** (`startTestRelay` with a temp `assetDir` and small caps via overrides, `createTable` for a secret): upload a 3-part PNG (parts of 8 MiB with a PNG header in part 0) then complete → `200 {hash}`; complete again → `200` at once; `GET` status after part 0 and 2 → `{parts:[0,2]}` (resume); a part of 8 MiB + 1 byte → `413`; part 0 starting `<svg` or `<!doctype html>` → `415`; wrong final hash → `422` and status shows no parts; wrong secret → `401`; 61 part requests in a minute from one address → `429` on the 61st; a third concurrent upload → `429`; `maxTableAssetBytes` exceeded → `507`; `minFreeBytes` above the disk's free space → `507`; `keeps the ticket key across saves` — create a table after start, reload the state file, the key is still there and unchanged; `deletes images when a table ends` — end the table (unhosted timer or `registry.end`) → its folder is gone; parts older than 1 hour are swept (fake `now`). Log lines (capture `log`) contain no secret and no query string.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces; stream request bodies with `pipeline(req, counter, createWriteStream(tmp))`, rename on success; the in-flight count is released in `finally`.
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: image store with table-secret uploads, resume and disk caps"`.

### Task 4: Relay tickets and ticketed downloads

**Files:**
- Create: `apps/relay/src/assets/tickets.ts`, `apps/relay/src/assets/downloadRoute.ts`
- Modify: `apps/relay/src/http.ts` (route `GET /api/assets/{hash}` before static), `uploadRoutes.ts` (mint route), `apps/relay/README.md`
- Test: `tests/unit/relay/assetTickets.test.ts`

**Interfaces:**
- Produces (`tickets.ts`): `mintTicket(key: Buffer, code: string, player: string, hash: string, expiry: number): string` (the `t` value) and `readTicket(key: Buffer, t: string, hash: string, now: number): { code: string; player: string } | null` — split on `.` into exactly 4 parts, `code` matches `TABLE_CODE_PATTERN`, `player` matches `PLAYER_ID_PATTERN`, expiry an integer; returns null if `expiry <= now` before computing the MAC; then decodes the MAC, checks length 32, `timingSafeEqual`.
- Mint route: `POST /api/tables/{code}/assets/{hash}/tickets` with `{player}` (4 KiB JSON body) → `200 {url:'/api/assets/<hash>?t=<ticket>', expires}` where `expires = now + 120_000`; `404` when the store does not hold the hash; `400` for a bad player id. Spec gap ruling: the server signs because only it holds the key; the GM asks per (hash, player).
- Download: `GET /api/assets/{hash}?t=...` → the bytes with the exact headers of Global Constraints; any failure → the same `404` (`{"error":"not-found"}` with `cache-control: no-store`), including a ticket for another table's hash or another hash.

- [ ] **Step 1: Write the failing tests:** a minted ticket downloads the exact bytes with all five headers; after 120 s (fake clock) → `404`; the same ticket for another hash → `404`; a ticket whose MAC has one character changed → `404`; a ticket with the player id swapped → `404`; an unknown hash with a valid-looking ticket → `404` byte-identical to the others; a ticket from a relay restarted with a new state file → `404`; after table end → `404`; a ticket minted for table A cannot fetch table B's copy of the same hash; no log line contains `?t=` or the MAC.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay/assetTickets.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: HMAC image tickets and ticketed downloads"`.

### Task 5: GM uploader and `asset-ticket` answers

**Files:**
- Create: `src/app/online/gm/assetUpload/binaryHttp.ts`, `assetUpload/uploadAsset.ts`, `assetUpload/AssetTickets.ts`
- Modify: `gm/assetAnswers.ts:6-12,42-91` (optional ticket port; `via:'socket'`), `gm/assetServe.ts` (throttle key gains `#socket` for `via`), `gm/SceneShare.ts:144`, `gm/pins/FoundShare.ts:46`, `gm/image/ImageShare.ts:49` (pass the port; `book/bookAssetDesk.ts` stays on chunks), `gm/OnlineTable.ts` (build one `AssetTickets` per table from origin, code, secret), `tests/unit/online/noKeys.test.ts` (allowlist `binaryHttp.ts`)
- Test: `tests/unit/online/gm/assetTickets.test.ts`, `tests/unit/online/gm/uploadAsset.test.ts`

**Interfaces:**
- Produces (`binaryHttp.ts`): `type BinaryHttp = (request: { url: string; method: 'GET' | 'PUT' | 'POST'; secret: string; body?: ArrayBuffer; json?: unknown }) => Promise<{ status: number; json: unknown }>`; `obsidianBinaryHttp: BinaryHttp` (wraps `requestUrl` with `throw:false`, `contentType` `application/octet-stream` or `application/json`; logs status classes only, never the URL's secret or the body).
- Produces (`uploadAsset.ts`): `uploadAsset(http: BinaryHttp, table: { origin: string; code: string; secret: string }, hash: string, bytes: Uint8Array): Promise<boolean>` — `GET` status, `PUT` missing parts (8 MiB slices, each tried up to 3 times), `POST complete`, true only when the answer's `hash` equals `hash`.
- Produces (`AssetTickets.ts`): `class AssetTickets { constructor(http: BinaryHttp, table: {...}, now: () => number); ticket(hash: string, bytes: Uint8Array, player: string): Promise<AssetTicketMessage | null>; forget(): void }` — one upload per hash at a time (shared promise), uploaded hashes remembered, a failed hash is not retried for 60 s (returns null at once), tickets reused per (hash, player) until 10 s before `expires`.
- Produces: `AssetAnswerPorts.tickets?: AssetTickets` and `levelOf?(player: string): number`. In `serveImage` (after sending `asset-variant`, ticketing the variant hash) and `serveArt`: when `tickets` is set, the player's level is `>= 2` and the request has no `via`, send the ticket instead of chunks; on `null` serve chunks as today. Explored masks and text stay on chunks. The original is ticketed only for a request without `maxSide` (6.7).

- [ ] **Step 1: Write the failing tests:** `uploadAsset` against a fake `BinaryHttp` — 20 MiB bytes → 3 PUTs of 8, 8, 4 MiB then complete; status `{parts:[0]}` → only parts 1, 2 sent; a part failing twice then succeeding → uploaded; three failures → false; complete answering another hash → false. `AssetTickets`: two concurrent tickets for one hash → one upload; second player → no second upload, a second mint; failed upload → null, and a call within 60 s → null without a request. `AssetAnswers` (shareHarness, fake tickets): a level-2 player's map request → `asset-variant` then `asset-ticket` for the variant hash and no `asset-chunk`; a level-1 player → chunks; `via:'socket'` within 10 s of the ticketed request → chunks (not throttled); tickets returning null → chunks; a request for an asset not in the player's picture → `asset-refused`, and the fake `tickets` is never called. `noKeys.test.ts` passes with the one new allowlisted file.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: upload images to the server cache and answer with tickets"`.

### Task 6: Player ticket downloads with socket fallback

**Files:**
- Create: `apps/play/src/assets/ticketFetch.ts`
- Modify: `apps/play/src/assets/AssetLoader.ts:13-17,97-118` (case `asset-ticket`; split the file if it passes ~300 lines), `apps/play/src/app/session.ts` (`onFallback` → local log line), `locales/{en,zh}/onlinePlay.ts` (`onlinePlay.assets.socketFallback`)
- Test: extend `tests/unit/play/assetLoader.test.ts`

**Interfaces:**
- Produces (`ticketFetch.ts`): `fetchTicket(fetcher: typeof fetch, url: string, maxBytes: number): Promise<Uint8Array | null>` — `fetch(url, { credentials: 'omit', cache: 'no-store' })`, null on any non-200, network error, or more than `maxBytes` read.
- Produces: `LoaderPorts.fetch?: typeof fetch` and `LoaderPorts.onFallback?: (hash: string) => void`. On `asset-ticket` for a pending download's expected hash (the variant hash once `asset-variant` named one): fetch, verify size and SHA-256, cache by hash, finish. On failure: send `{t:'asset-request', hash, maxSide, via:'socket'}` once, call `onFallback(hash)` once, continue on chunks with the existing stall/re-ask rules.

- [ ] **Step 1: Write the failing tests:** a ticket whose fetch returns the right bytes → loaded, cached, no chunk request sent; a variant flow (`asset-variant` then `asset-ticket` for the variant hash) → loaded at the variant's world size; `falls back once on a failed ticket` — fetch 404 → exactly one `via:'socket'` request and one `onFallback`, then chunks complete the load; a second ticket arriving for the same hash after fallback is ignored; wrong bytes (hash mismatch) → fallback, nothing cached; a ticket for a hash with no pending download → ignored; a ticket `url` is fetched exactly as given (same-origin path).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/assetLoader.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces; the session's fallback line uses the same local-line path the app uses for its own refusals.
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: download images by ticket, fall back to the GM's socket"`.

### Task 7: Lighting inputs adapter (pure)

**Files:**
- Create: `apps/play/src/lighting/lightingInputs.ts`, `apps/play/src/lighting/sightRulesOf.ts`, `apps/play/src/lighting/lightingStore.ts`
- Modify: `apps/play/src/state/tableStore.ts:77-103` (keep `lighting`, `sight`, `explored`, `doors`, `sensed` for the current scene; clear on scene change)
- Test: `tests/unit/play/lightingInputs.test.ts`

**Interfaces:**
- Produces: `TableState.lit: { lighting: SharedLightingScene | null; sight: SharedSight | null; explored: AssetRef | null; doors: readonly SharedDoor[]; sensed: readonly SensedMark[] }` (reset when `scene.id` changes).
- Produces (`lightingInputs.ts`): `class LightingInputs { update(lighting: SharedLightingScene, sight: SharedSight, map: MapBounds): SceneState }` — walls from `SharedWall` (inverse of `gm/sceneInputs.ts:54-61`: `door:'open'` → `type:'door', closed:false`, `'closed'` → `type:'door', closed:true`, else `type:'solid'`, plus `direction`, `blocks`, `limited`), zones to `objects.lightZones`, `grid` `{enabled:true, size: cellSize, offsetX:0, offsetY:0, opacity:1}`, lights and tokens (vision `{enabled:true, angle?}`, `light`, `conditions` = effects, `isHidden:true` on every vision token when `sight.blind`), `heldTokens` from `held`. Each output record is the same object as the previous call's when its input is deep-equal (walls/zones by the `lighting` message identity, each token and light by value), so `SceneModelBuilder` does not rebuild.
- Produces (`sightRulesOf.ts`): `sightRulesOf(lighting: SharedLightingScene, sight: SharedSight): SightRules` — `definitions` = `senses`, `visionOf(token)` from the token's `SharedVision` (`senses`, `sightRange`, `pending`), `conditions` = one synthetic `ConditionDefinition {id, name: id, color:'#000000', effect: id}` per `SharedEffect`.
- Produces (`lightingStore.ts`): `createLightingStore(): LightingStore & { apply(state: SceneState, exploredMask: string | null): void }` (plain zustand store satisfying `LightingState`; `setExploredMask` / `setExploredEdits` keep local values only; `isMapLoading` true until `apply`).

- [ ] **Step 1: Write the failing tests** (node, modelled on `src/app/vision/__tests__/sceneModelStandalone.test.ts`): one room's `lighting` + `sight` → `new SceneModelBuilder().update(state, bounds, measurement, () => rules)` gives a sight polygon for the token that stops at the room's walls; an open door wall lets sight through, a closed one does not; `blind:true` → no player sight (not all-sight); a second `sight` with only one token moved → the other token's object and the walls record are the same objects (`toBe`), and `rebuilt` is false when nothing changed; a `blinded` effect on the only token → no sight; the module imports no `pixi.js` (same check as the standalone test); `tableStore` keeps `sight` per scene and clears `lit` on scene change.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/lightingInputs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: adapt shared lighting inputs to the lighting engine's scene state"`.

### Task 8: Lit scenes in `SceneView` (probe, layers, fail closed)

**Files:**
- Create: `apps/play/src/lighting/lightingProbe.ts`, `apps/play/src/lighting/storedAttempt.ts`, `apps/play/src/scene/LitScene.ts` (owns `LightingRenderer`, `SensedOutlines`, door badges), `apps/play/src/scene/doorBadges.ts`
- Modify: `apps/play/src/scene/SceneView.ts` (layer order; split out what pushes it past ~300 lines), `state/sceneMode.ts:7-10`, `scene/mapRequest.ts:19`, `ui/SceneCanvas.tsx:34-35`, `ui/LitPlaceholder.tsx`, `locales/{en,zh}/onlinePlay.ts`
- Test: `tests/unit/play/sceneMode.test.ts` (extend), `tests/gpu/playLighting.gpu.test.ts`

**Interfaces:**
- Produces (`lightingProbe.ts`): `canRunLighting(renderer: Renderer): boolean` — WebGL2 renderer, `EXT_color_buffer_float` (or `EXT_color_buffer_half_float`), a 1×1 `rgba16float` and an `r16float` render target that are framebuffer-complete and render without a GL error; result cached per renderer.
- Produces (`storedAttempt.ts`): `storedLightingAttempt(storage: Storage | null): LightingAttempt` over key `atlas-play:lighting-attempt` (`begin()` false when a begun attempt never finished: a crash loop; storage errors read as allowed once per session).
- Produces (`sceneMode.ts`): `sceneMode(scene, lighting: 'unknown' | 'ready' | 'unsupported'): 'none' | 'unlit' | 'lit' | 'placeholder'` — a lit scene is `'lit'` only with `'ready'`; `mapRequest` asks for a lit map only in `'lit'` mode.
- Produces (`LitScene.ts`): `class LitScene { constructor(deps: { viewport: Viewport; app: Application; store: TableStore; map: () => { bounds: MapBounds | null }; quality: LightingQualitySource; attempt: LightingAttempt; onUnavailable(): void }); readonly ready: boolean /* sight current and engine has a world */; destroy(): void }` — builds `LightingRenderer` in player mode (`modeLayer.visible = true`), `albedo: () => null`, `quality` `saver` in low-power mode; turns the `explored` PNG (via `AssetLoader`) into `data:image/png;base64,…`.
- Layer order (viewport children, bottom to top): map, grid, tokens (whole, art and bars), lighting layer (`zIndex` 90, `sortableChildren` on the viewport), fog, sensed outlines, door badges (`doors`), pins/annotations, selection. Map, grid and tokens containers stay `visible = false` until `LitScene.ready`; any `onUnavailable`, `webglcontextlost` or failed probe destroys the `LitScene`, hides them again and sets the mode to `'placeholder'` for the rest of the session.
- Placeholder texts: preparing "正在准备光照… / Preparing lighting…"; unsupported "此设备无法显示动态光照 / This device cannot show dynamic lighting" (replaces `onlinePlay.lit.placeholder`).

- [ ] **Step 1: Write the failing tests.** Unit: `sceneMode` table for `lit` × probe state; `mapRequest` never asks for a lit map unless `'ready'`. GPU (`playScene.gpu.test.ts` pattern, real `SceneView` with a white map): `lights only what the token sees` — a room with walls and one vision token, ambient 0, a light inside → pixels inside the room are lit, a pixel behind a wall equals the unexplored colour (black); `keeps the map hidden until sight is current` — `scene` + map loaded but no `sight` → every sampled pixel is the background, never white; `falls back to the placeholder on context loss` — `WEBGL_lose_context.loseContext()` → map container not visible and mode `'placeholder'`; `draws sensed outlines and door badges` from `sensed` / `doors`; an unlit scene renders exactly as before (2a's `playScene` tests stay green).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play` and `npx vitest run --project gpu tests/gpu/playLighting.gpu.test.ts tests/gpu/playScene.gpu.test.ts tests/gpu/playTokens.gpu.test.ts`. Expected: FAIL (new tests).
- [ ] **Step 3: Implement** per the interfaces (read current PixiJS v8 docs for render targets and `sortableChildren`).
- [ ] **Step 4: Verify** the per-task checks, `npm run build:play` and the GPU command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: draw lit scenes with the shared lighting engine, fail closed"`.

### Task 9: Dragging own tokens, remote drags

**Files:**
- Create: `apps/play/src/scene/DragController.ts`, `apps/play/src/scene/dropSnap.ts`, `apps/play/src/scene/liveTokens.ts`
- Modify: `scene/gestures.ts` (drag stream), `scene/canvasInput.ts`, `scene/TokenLayer.ts:47,70` (overrides), `scene/SceneView.ts` / `ui/SceneCanvas.tsx` (send port), `state/tableStore.ts` (`snap`, `live`, `refused`), `locales/{en,zh}/onlinePlay.ts`
- Test: `tests/unit/play/dragController.test.ts`, `tests/unit/play/dropSnap.test.ts`, extend `gestures.test.ts`, `canvasInput.test.ts`, `tableStore.test.ts`

**Interfaces:**
- Produces (`gestures.ts`): `Gesture` gains `{ kind: 'drag-move'; id: string; x: number; y: number }`, `{ kind: 'drag-end'; id: string; x: number; y: number }`, `{ kind: 'drag-cancel'; id: string }` (screen coordinates); a second pointer, `pointercancel` or `lostpointercapture` during a token drag emits `drag-cancel` before `pinch`.
- Produces (`dropSnap.ts`): `snapDrop(point: Point, token: SharedToken, snap: SnapGrid | null): Point` — no snap → the point; else `snapTokenCenter(point, footprint cells, snap.type, snap.size, cellSnapper)` (`src/app/grid/gridPlacement.ts:35`) with a square cell snapper or `nearestHexCenter(createHexLayout(type, size, offsetX, offsetY), p)` (`src/app/grid/hexGeometry.ts:48,135`).
- Produces (`DragController.ts`): `class DragController { constructor(ports: { send(body: PlayerMessage): boolean; store: TableStore; toWorld(x: number, y: number): Point; now(): number; preview(id: string, at: Point | null): void }); handle(gesture: Gesture): void; stop(): void }` — starts only for an id in `mine`, not `held`, while not paused; sends `drag` at most every 100 ms (the latest point, unsnapped); `drag-end` sends `move` with `snapDrop`; `drag-cancel` sends `drag-cancel`; keeps the preview at the drop until the token list shows the token there, a `move-refused` for it arrives (then the preview clears and the list's place shows), or 3 s pass.
- Produces (`liveTokens.ts`): `TableState.live: ReadonlyMap<string, Point>` from `live` messages (latest wins, `end` removes, cleared on scene change); `TokenLayer.sync` draws a live place over the list's, except for the token the local drag controls.
- `move-refused` shows a short notice: `turn` → "还没轮到你 / Not your turn", `paused` → "游戏已暂停 / Game paused", none → nothing extra.

- [ ] **Step 1: Write the failing tests:** gestures — an own-token drag yields `drag-token`, `drag-move`s and `drag-end`; a second finger mid-drag yields `drag-cancel` then `pinch`; `pointercancel` yields `drag-cancel`. `DragController` (fake clock) — 1 s of moves sends ≤ 10 `drag`s and the last point; drop on a square grid of 70 px sends `move` at the cell centre; a 2-cell token snaps to a cell corner; `snap:null` sends the raw point; a `held` or not-`mine` token sends nothing; `move-refused` clears the preview; `stop()` mid-drag sends `drag-cancel`; a disconnected `send` (returns false) mid-drag clears the preview without throwing; camera drag is re-enabled after cancel (`canvasInput.test.ts`). `liveTokens` — `end:true` removes the place; own dragged token's echoes are ignored. `dropSnap` hex cases for both orientations.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces. No client-side wall check: the GM's result is authoritative.
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: drag own tokens, follow remote drags"`.

### Task 10: Player pause state and banner

**Files:**
- Create: `apps/play/src/ui/PauseBanner.tsx`
- Modify: `state/tableStore.ts` (`paused`, handled before the `scene` guard like `roll-refused`), `app/session.ts`, `ui/PlayApp.tsx` (banner), `scene/DragController.ts` (`stop()` when paused turns on), `locales/{en,zh}/onlinePlay.ts`
- Test: `tests/unit/play/pause.test.ts`

**Interfaces:**
- Produces: `TableState.paused: boolean` (set by `pause`, reset to false on a new welcome before the GM's re-send); `PauseBanner` shows "游戏已暂停 / Game paused" while true, under the status bar, not covering the dice tray.

- [ ] **Step 1: Write the failing tests** (jsdom): `{t:'pause', paused:true}` → banner shown and a running drag is cancelled (`drag-cancel` sent, preview cleared); `paused:false` → banner gone; a reconnect clears it until the GM says otherwise; while paused a `drag-token` gesture sends nothing.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/pause.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: show when the game is paused"`.

### Task 11: End to end, browser check, docs

**Files:**
- Modify: `tests/unit/play/endToEnd.test.ts` (binary `requestUrl` mock: `body?: string | ArrayBuffer`, returns `arrayBuffer`), `tests/e2e/playPage.e2e.test.ts`, `docs/fork/online-contract.md`, `docs/fork/FORK_GUIDE.md` (relay env and asset store note), `apps/relay/README.md`, `docs/fork/online-followups.md`
- Test: the two files above

- [ ] **Step 1: Write the failing tests.** `endToEnd.test.ts` (real relay + real `OnlineControl` + real `Session`): the map reaches the player by ticket — `assetsServed` shows no chunks for it and the relay's asset dir holds its hash; with the relay's asset routes failing (`maxServerAssetBytes: 0`) the map still arrives by chunks and the player log shows the fallback line once; the GM pauses → the player's store is `paused`, a `move` comes back `move-refused {reason:'paused'}` and the token stays; unpause → a `move` lands; a player who reconnects while paused is paused again after its `client` message. `playPage.e2e.test.ts` (Chromium, swiftshader, real CSP): a lit scene with one vision token in a walled room shows lit pixels inside and black outside, and never a frame of the unlit map before (sample the canvas from the first frame on); a ticketed image loads under the CSP (`connect-src 'self'`); a mouse drag of an own token sends `drag`s and a `move`, and the token is drawn at the snapped cell.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/endToEnd.test.ts` and `npm run test:play-e2e`. Expected: FAIL.
- [ ] **Step 3: Fix** what the tests reveal (wiring only; a defect in an earlier task's unit goes back to that unit with a test). Update the docs: contract (fork level 2 messages, asset routes, ticket format), FORK_GUIDE commands, relay README env (`ASSET_DIR` and caps), follow-ups (residuals found here).
- [ ] **Step 4: Verify** everything: per-task checks, `npm run build:play`, `npx vitest run --project unit`, `npm run test:gpu -- tests/gpu/play*`, `npm run test:play-e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "M4: end-to-end tests and docs for lighting, moves, pause and the image cache"`.

## Rulings in this plan (spec gaps)

- Tickets are minted by the relay through `POST .../assets/{hash}/tickets` (table secret): the spec keeps the signing key on the server only, so the GM cannot sign.
- `asset-request` gains `via:'socket'` so a player can leave the ticket path; the GM throttles it separately from the ticketed request.
- Pause is checked in `PlayerMoves.receive` / `PlayerDrags.receive`, not in `checkMove`: the spec asks for "before the rate limit", which `checkMove` runs after.
- "Broadcasts drag-cancel" is realised as ending player drags `'back'`, which the existing `live … end:true` carries to every screen; no GM-to-player `drag-cancel` exists.
- `sight` is the party's (every non-hidden vision token), as the GM computes it today; the player app draws what it is sent.
- Tokens are drawn whole under the lighting layer (bars dim with their token); the map's albedo is not given to the engine (bounce reads mid grey). Both can be refined later without protocol changes.
- No client-side wall pre-check for drags; the GM's landing is authoritative.
