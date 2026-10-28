# Self-hosted online play for the Atlas VTT fork

Status: draft for review, revision 7 (after five independent reviews and a builder check; revision 6 added
features borrowed from a study of Foundry VTT, `docs/fork/research/`).
Date: 2026-10-26. Fork: `luoxin9510/atlas-vtt` (public), branch `fork/work`
(upstream baseline 0.9.1, `5499fd87`).

## 1. Intent

The user runs tabletop RPG games as GM in Obsidian with Atlas VTT and wants an experience like
Foundry VTT: the GM hosts, players join from a web browser on their phone or computer, with no
Obsidian, no install and no account. The server is the user's own (the existing Hetzner VPS,
since 2026-10-28 for production too, 6.5), not upstream's hosted Atlas Online (`play.atlas-vtt.dev`, closed beta, account and invite
needed). The fork becomes the user's own product, developed independently of upstream from here
on, and Simplified Chinese is the default language. The GM and all players are in mainland China,
on home broadband and mobile networks, without a VPN.

## 2. Goals, non-goals, anti-goals

Goals (MVP), numbered to the milestones that deliver them:
- G1 (M1-M2). The GM starts a table from Atlas against the user's server; Atlas shows the join
  link and QR code as today.
- G2 (M3). A player opens the link on a phone or desktop browser, enters a name and the join
  code, and is in. Returning players are recognised (saved key, or their own 6-digit code if the
  browser lost its data).
- G3a (M3). Players see the presented scene: map image, tokens, fog of war, exactly the per-player
  data the GM client already computes. A scene whose `scene.lit` is true, missing or not a
  boolean shows a placeholder until G3b (fail closed); the M3 renderer ignores `lighting`, `sight`
  and `explored` messages, and the unlit map is never drawn for a lit scene.
- G3b (M4). Dynamic lighting and the player's own vision, via the shared lighting engine. A device
  whose GPU cannot run it gets the same placeholder, never the unlit map.
- G4 (M4). Players drag their own tokens with touch or mouse; the GM's existing checks accept or
  refuse each move.
- G5 (M3). Players roll dice in the protocol's four modes (public, GM, blind, self), read the
  table log and chat, see the initiative order, and get a "your turn" alert when their own
  combatant gets the turn.
- G6 (M5). Players read the notes the GM chose to share, formatted like Obsidian (headings,
  lists, callouts, images, links between shared notes), only while the game runs.
- G7 (M1, M3). The online UI of the GM and the whole player app are Simplified Chinese by
  default, English selectable.
- G8 (M4). Images reach players quickly from mainland networks: the GM uploads each image once to
  the server, and players download it from there (6.7), instead of every image travelling from the
  GM's home upload to each player; the socket path stays as the fallback when that fails.
- G9 (M3-M4). Phone-first interaction: one fixed touch gesture set and a low-power mode (6.3).
- G10 (M4). The GM can pause the game: players' token moves are refused and every player sees
  that the game is paused.

Non-goals (MVP): upstream's account service and invite keys; Cloudflare Workers or Durable
Objects; the SSE stream lane; character books/sheets, rests, quests; lasers/measures/cursors (cheap to add right after M4: the
GM side, the protocol messages (`protocol/marks.ts`) and the remote renderers in `marks/` already
exist);
widgets; audio; 3D dice; notes readable while the GM is offline; Obsidian mobile as GM; several
GMs per server; compatibility with upstream's hosted service.

Anti-goals (a failure even if it works): anything the GM hides reaching a player (hidden tokens,
fog-covered or unlit areas, GM-only pins, unshared notes, GM-only parts of shared notes, links,
titles or embeds of unshared notes); a fork build talking to upstream's servers without the user
choosing so; breaking the GM's desktop workflow or offline use; players needing an install or an
account; strangers hosting tables on the user's server.

## 3. What exists today (verified in code)

Full contract survey with `file:line` references: `docs/fork/online-contract.md` (committed in
M0 from the survey notes). Summary:

- The GM client is complete and in the repo: `src/app/online/gm/` (199 files, ~21k lines),
  `protocol/` (50 files, ~6.2k lines), `marks/`, `movement/`, `tableLog/` (React log UI), with
  164 test files in `tests/unit/online/`. `protocol/`, `marks/`, `movement/` and `tableLog/` are
  in the `shared` boundary (`scripts/boundaries.mjs`, `tsconfig.shared.json`): no Obsidian, no
  network, usable by a browser app.
- All game logic is GM-side: per-player visibility (fog, sight, lighting, hidden tokens; leak
  tests `tokenLeak`, `inputLeak`, `marksLeak`, `mapLayersLeak`), move validation, dice, seats,
  asset serving. Assets are not uploaded: a player requests one by SHA-256 over the socket and the
  GM answers in 256 KiB base64 chunks, only for assets in that player's current picture
  (`protocol/asset.ts`, `gm/assetAnswers.ts:42-55`).
- The relay is a near-dumb router plus the join gate: HTTP `POST /api/tables`; WebSocket
  `/api/tables/{code}/socket` (`TableConnection.ts:58`) with text JSON frames `v:1`, bare
  `ping`/`pong`, limits 320 KiB per GM frame and 4 KiB per player frame (`protocol/relay.ts:26-34`);
  it never reads game bodies (`relay.ts:173`).
- Not in the repo: upstream's player app (`apps/play`) and relay (a Cloudflare Durable Object).
- The online code uses no i18n (about 131 hard-coded English strings).
- Server origins are `export const` in `src/app/online/gm/servers.ts`; hosting is gated by an
  account token (`tableStart.ts:34`) from an OAuth device flow on `api.atlas-vtt.dev`.

## 4. Approaches considered

- A. Compatible relay + new player app, upstream's protocol and GM client unchanged. Fastest and
  reuses tested logic, but ties the fork to upstream's protocol.
- B. New, smaller protocol and GM module from scratch. Full ownership, but rewrites ~30k lines of
  tested logic, including the security-critical per-player visibility filter.
- C (chosen by the user). Hybrid: start as A on the tested code to reach a real game soon,
  declare `src/app/online/` fork-owned from M0 so the protocol may change freely, then prune and
  reshape it over time.

## 5. Architecture

```
GM laptop: Obsidian + Atlas fork  ──wss──▶  server: relay (Node) + player app at /  ◀──wss/https──  players
 (all game state and logic, vault) ──https─▶  + image cache (6.7)                                (phones,
                                                                                                  desktops)
```

Monorepo inside the fork (my call, upstream's naming): `apps/relay/` (Node 22, TypeScript, `ws`;
imports the shared `protocol/` parsers) and `apps/play/` (Vite, React, PixiJS v8; may import only
the `shared` boundary set plus allowed npm packages; the boundary check is extended to enforce
it). Plugin changes stay in `src/`.

## 6. Decided parts of the design

### 6.1 Plugin (GM side), M1
- Settings "联机服务器地址 / Online server address" and "主持密钥 / Host key". The address
  defaults to empty: online play stays unavailable until the user sets a server, so a fork build
  never contacts upstream on its own. Tests that pin upstream URLs are updated to set the address.
- `servers.ts` constants become accessors read from settings. Every place that uses the origins
  or the account token is changed (verified by the review):
  - `AccountControl` (`token()` users at lines 54, 60, 109, 116, 128, 146; `/api/me` at 127;
    `signOutToken` at 87, 111): on a custom server it returns the host key as the token, never
    calls `/api/me` or sign-out, and the dock's account menu shows "主持密钥已设置" instead of
    sign-in.
  - `tableStart.ts:34` and `OnlineControl.ts:271` (start gating) keep working via `token()`.
  - `createTable.ts` sends `Authorization: Bearer <host key>` through the existing `token()` path,
    so no new file writes the header and `noKeys.test.ts` (line 49: only `relayAccount.ts` and
    `createTable.ts`) keeps holding. The image upload of 6.7 is a new binary module that calls
    `requestUrl` and sends the table secret; the test's two allowlists (the Bearer header, line 49,
    and `requestUrl(`, line 51) are extended for exactly that module.
  - `gmLevel.ts:19,25` keys its cache by the configured origin; `companionDiagnostics.ts` posts
    nowhere on a custom server (diagnostics off).
- The host key lives in Obsidian secret storage (Obsidian >= 1.11.4, already the feature's
  minimum).
- The hard-coded strings in `src/app/online/` (GM UI and the shared `tableLog/` UI that the player
  app reuses; about 131 by the heuristic scan, a full inventory is made in M0) go through `t()`
  with zh translations, as in phase 2. `tableLog/` and `i18n` are both in the shared boundary, so
  `tableLog/` may import `t()`.

### 6.2 Relay (`apps/relay`), M2
- Contract as surveyed (`docs/fork/online-contract.md` sections 1-2 and 8.2). Specifics:
  - One host key per server (`HOST_KEY` env). `POST /api/tables` needs `Bearer <HOST_KEY>`
    (else 401) and echoes the client-chosen code: the GM treats a different code as a stray table
    and ends it (`tableStart.ts:58-62`). The relay mints a base64url secret of 43 characters
    (client requires >= 32, `createdTable.ts:40`; pattern 16-128, `relay.ts:166`). `maxPlayers`
    from config, default 8, valid 1-12 (protocol `MAX_PLAYERS` 12).
  - A code is bound to the server's single host. A re-POST of an existing code with the host key
    replaces the secret and closes the old GM socket with 4002 (only the key holder can do this,
    and there is one host). 4002 is final for the old socket: a second Obsidian of the same GM
    that held the table loses it. At most 10 tables per server; more answer 429.
    `POST /api/tables` is rate-limited (10 per minute) and wrong host keys back off (5 failures
    lock the endpoint for 10 minutes per client address).
  - The secret is a bearer credential for the GM socket: stored only as a hash, compared in
    constant time.
  - WebSocket routing, join gate and close codes as surveyed. Gate values (upstream's are not in
    the repo; my calls): a knock waits 3 minutes (then 4013); 5 wrong codes in 10 minutes pause
    the gate for 10 minutes (4011 + `gate-paused`); at most 8 waiting knocks.
  - Abuse limits: at most 20 sockets per client address, player frame rate above 20/s closes with
    4005. Until a socket's hello is accepted as the GM, its frames may be at most 4 KiB; a
    welcomed GM socket accepts up to 512 KiB (GM frames reach 320 KiB); player frames over 4 KiB
    close with 4004.
  - The client address is the TCP peer, or the proxy's forwarded header only when the relay is
    configured to trust that proxy (it listens on localhost behind it).
  - Player sockets and `POST /api/tables` must come from the server's own public origin (`Origin`
    check); the GM socket is not origin-checked by policy (Obsidian sends `app://obsidian.md`).
  - `GET /api/me` returns a fixed host account; `/api/reports` and `/api/feedback` answer 204 and
    store nothing. Static files of `apps/play` are served at `/`.
- Secrets never reach logs: the relay logs no `Authorization` header, table secret, host key,
  ticket or query string, and the proxy configuration of 6.5 does the same.
- State in memory; code, secret hash, player keys and roster ids are written atomically to one
  JSON file so a restart keeps tables (the GM re-sends gate and roster on every welcome). Tables
  nobody hosts for 14 days are deleted. No game body is parsed or logged.

### 6.3 Player app (`apps/play`), M3-M4
- Join from `/#<code>`: name, join code or own 6-digit code. The player key is kept in
  localStorage; clearing site data loses it, and the own code recovers the seat.
- Socket client per the contract: hello, welcome, `ping` every 30 s, reconnect with backoff, final
  close codes explained, waiting screen, GM-offline banner.
- Messages via the shared `parseRelayFrame`, `parseGmMessage`, `DeltaReader` (+ `resync` on
  gaps), `part` reassembly (new), asset downloader with SHA-256 check and an IndexedDB cache.
- Scene view (PixiJS v8): map, tokens, fog (M3); pinch zoom and pan; lighting and vision (M4),
  after a capability probe of the float render targets the lighting engine needs; dragging own
  tokens (M4: `mine`, `move`, `drag`, `drag-cancel`, `move-refused`).
- Panels, phone-first (bottom sheet on narrow screens): log and chat (shared `tableLog/`), dice
  roller (`roll`) with a tray of dice chips rather than typed commands, initiative list, players
  list with online state (from the existing `people` log message), shared notes (M5).
- Touch gestures (the set community touch modules for Foundry settled on): one finger on an own
  token drags it; one finger elsewhere and two fingers pan; pinch zooms (never rotates tokens);
  a tap selects; a long press (about 0.5 s) opens the context menu. Mouse users get the same
  actions with left drag, wheel zoom and right click.
- Low-power mode (a player setting, on by default when the device reports reduced motion or a
  small GPU budget): frame rate capped at 30, no animations, lower render resolution.
- "Your turn" (fork protocol extension): the shared initiative list deliberately carries no token
  ids or owners (`SharedCombatant`, `protocol/initiative.ts:14-30`), so the player app cannot tell
  its own combatant. The GM client, which knows ownership, sends `your-turn {scene}` to the owning
  player only when that player's combatant's turn changes from false to true; never on resyncs,
  reconnects or full-list resends. The app shows a banner and vibrates where the browser allows it
  (`navigator.vibrate`; iOS Safari has none, so the banner alone).
- Roll modes reuse the existing protocol unchanged: `PlayerRoll.mode` is `RollMode` =
  `public | gm | blind | self` (`protocol/chat.ts:13`), and the GM client already routes each
  result only to its audience (`rollAudience` in `gm/PlayerRolls.ts`; `self` goes `to` the roller
  alone). The dice tray offers all four with Chinese labels (公开 / 仅主持人 / 暗骰 / 仅自己); `blind`
  means the roller does not see the result. A roll answering a roll button keeps the button's mode
  (`buttonMode` in `PlayerRolls.ts`) over the player's choice.
- Right after welcome the app sends a `client {app:'atlas-fork-play', forkLevel}` game message,
  parsed by a new branch of the shared `parsePlayerMessage`. `forkLevel` is a separate counter
  (constant `FORK_PROTOCOL_LEVEL` in `protocol/`), unrelated to upstream's `GM_LEVEL` 7. The GM
  client keeps a per-player capability record; a player who sent no `client` message has fork
  level 0. Fork-only GM messages (`notes`, `asset-ticket`) are sent only to players whose level
  supports them, and are added to `parseGmMessage`. Our app is the only player app; `forkLevel`
  is self-declared and decides only the format of messages, never access, which the GM decides
  per request as before.
- The app is served with a strict Content-Security-Policy (own origin only; no inline scripts).
- Chinese by default via the shared i18n, English selectable (localStorage).
- AGPL-3.0 section 13: the app shows a "源代码 / Source" link to the public fork and the licence.
- Tested on iOS Safari and Android Chrome, including mobile networks.

### 6.3a Pause, M4 (fork protocol extension)
- A pause switch in Atlas's online panel. The paused state is kept with the saved table in the
  plugin (so a GM reload keeps it).
- While paused, the GM client refuses every player `move` in `moveCheck.ts`, checked with the
  `turn` rule (line 53) and before the rate limit, answering `move-refused` with a new reason
  `paused` and the token's current x/y so the player's token snaps back. `drag` and
  `drag-cancel` received while paused are ignored without answers. Pausing broadcasts
  `drag-cancel` for every live remote drag so other screens drop them.
- `pause {paused}` is a fork-only GM message (added to `parseGmMessage`; `paused` added to the
  `move-refused` reason union and its parser). The GM sends it to every player of a fork level that
  supports it on each change and when such a player sends its `client` message (the GM's join
  re-send); players of level 0 are not sent it and just see their moves refused.
- The player app shows "游戏已暂停 / Game paused" and stops local drag previews.

### 6.4 Shared notes, M5 (fork protocol extension)
- A note is shared when its frontmatter has `atlas-share: true`. Only shared notes are ever read
  for players.
- The player copy is built by an allowlist over a Markdown syntax tree, never by regexes or
  denylists. The GM client parses the note (with Obsidian syntax: wikilinks, embeds, callouts,
  comments, block ids) and copies only these node kinds: headings, paragraphs, plain text,
  emphasis, strikethrough, inline code and plain code blocks, lists and task lists, tables,
  thematic breaks, blockquotes, callouts other than `[!gm]` (a callout's title is kept only as
  plain text, its type only if it is a standard Obsidian type, else it shows as a plain quote),
  links and images as resolved below.
  Everything else is dropped with its content: raw HTML and HTML comments, `%%comments%%`,
  frontmatter, `[!gm]` callouts (folded or not), code blocks with a language that names a plugin
  (`dataview`, `dataviewjs`, `tasks`, `query`, ...; plain languages such as `js` stay), footnote
  and reference-link definitions (their references become plain text), math, block ids.
- Links and embeds are resolved to a note or file first:
  - `[[note]]`, `[[note|alias]]`, `[[note#heading]]`, `[[note#^block]]`, Markdown links to vault
    paths: if the target is a shared note, an in-app link to that note (a heading fragment is
    kept as text only); otherwise the visible text only (the alias, or the link text; never the
    typed target or a path). Unresolved links become their visible text.
  - External links: only `https:` targets are kept; `http:`, `obsidian:`, `file:`, `app:` and any
    other scheme become plain text. Bare URLs follow the same rule.
  - `![[image]]` and `![](path)` of an image file: an asset reference by hash (6.7); the alt text
    is kept only when the author wrote one (`![[x.png|caption]]`), never the file name or path.
  - `![[note]]` and `![[note#part]]`: a link to the note if shared, removed otherwise; embedded
    content is never inlined.
- GM-only content inside a shared note is marked only by `[!gm]` callouts and `%%comments%%`;
  headings or other conventions do not hide anything. The share settings page says so.
- The note list (`notes` message) holds, for shared notes only, an id, the title (the file name
  without folder) and an optional display group from the note's `atlas-share-group` frontmatter,
  text the author writes for players, never derived from a folder name. Vault folders are never
  sent. Titles are never logged.
- Serving: note text is a `text/markdown` asset (`protocol/asset.ts:14`) served through the asset
  gate's existing `text(hash, player)` hook (`gm/assetAnswers.ts:26`, called at line 49). The hook
  looks the hash up in a hash-to-note map of currently shared notes, rebuilt when a note changes
  or its flag does. `AssetAnswers.answer()` already runs that lookup on every request (line 49),
  but one request queues all remaining chunks at once (`serve()`, lines 84-86, via `assetChunks`).
  The change: when a note stops being shared, its chunks still waiting in the GM's send queue are
  dropped for every player (a removal by asset hash in the send queue), later requests are
  refused (`asset-refused`), and it leaves the list. Chunks a player already received cannot be
  taken back, which is accepted.
- The player app renders the copy with a Markdown library (raw HTML disabled) plus callout
  support, then sanitises the HTML with an allowlist (no scripts, iframes, event attributes or
  non-https URLs).
- Leak tests in the existing family cover every rule above, including a shared note that embeds
  or links an unshared one, a `[!gm]` callout, comments, raw HTML, reference links, footnotes,
  links in tables and callouts, image file names, and a note unshared mid-download.

### 6.5 Deployment, M6
- Production (amended 2026-10-28, user decision): the existing Hetzner VPS, published as
  `https://play.xinsawi.com` through the Cloudflare Tunnel that already serves `pod.xinsawi.com`.
  The relay listens on localhost (`127.0.0.1:8787`) and runs as a systemd service; the tunnel
  terminates TLS, passes WebSocket upgrades and accepts request bodies up to 100 MB (image upload
  parts need at least 9 MiB, 6.7). Nothing else on the VPS changes (xray holds TCP 443).
  Reachability from mainland China is weaker than from a mainland or Hong Kong server; M6 checks
  it with a real game on phones on mobile data, and the earlier Alibaba Cloud plan (a mainland
  region needs an ICP filing before ports 80/443 serve; Hong Kong needs none; Caddy or nginx in
  front with WebSocket frames of 512 KiB) stays the documented fallback if that test fails.
- Before relying on the tunnel, M6 checks Cloudflare's WebSocket message size against 320 KiB
  frames and its idle timeout against the 30 s ping.
- The client address for limits comes from `TRUST_PROXY=none|xff|cf` (default `none`: the TCP
  peer): `xff` reads `X-Forwarded-For` from the configured reverse proxy, `cf` reads
  `CF-Connecting-IP` behind the tunnel.
- `HOST_KEY`, the public origin and the trusted proxy come from the environment; deployment notes
  and secrets stay in `~/Developer/vps-setup/`.
- A deployment checklist in the docs (the steps Foundry hosts most often get wrong): WebSocket
  `Upgrade`/`Connection` headers through the proxy, forwarded-address header, request body size,
  TLS certificate renewal, restarting proxy and relay together, and testing the join link from a
  phone on mobile data rather than from the GM's own network.

### 6.6 Upstream policy, M0
- `src/app/online/`, `apps/` and the online protocol are fork-owned from M0: no more upstream
  merges there; the rest of the plugin may still merge upstream. Recorded in
  `docs/fork/FORK_GUIDE.md`, replacing the earlier "do not touch Atlas Online code" rule, which the
  user lifted.

### 6.7 Image cache on the server, M4 (fork protocol extension)
- Why: from mainland home broadband the GM's upload is the bottleneck; upstream sends every image
  from the GM to each player in 256 KiB socket chunks.
- Upload (GM to server), a new binary module in the plugin (the JSON-only `Http` of
  `account/http.ts` is not reused): `PUT /api/tables/{code}/assets/{sha256}/parts/{index}` with
  `Authorization: Bearer <table secret>`, parts of 8 MiB, each retried on failure; then
  `POST .../assets/{sha256}/complete`. The server streams parts to disk, rejects a body over the
  part size or a total over 64 MiB (`MAX_ASSET_BYTES`, `protocol/asset.ts:9`) while receiving,
  sniffs the magic bytes and accepts only PNG, JPEG, WebP, GIF and AVIF (never SVG or HTML),
  verifies the SHA-256 on completion and answers `200 {hash}`, which the client checks. Uploading
  a hash the server already holds is idempotent (`200` at once); an interrupted upload resumes
  from the parts the server reports. Per table: at most 2 uploads at a time and 2 GiB in total;
  per server: 10 GiB in total and at least 2 GiB of free disk, else `507`.
- Variants: the GM client already scales images for a request's `maxSide` and sends the scaled
  copy under its own hash (`asset-variant`). With the cache it uploads that variant under its own
  hash and tickets it; the original is ticketed only for a request without `maxSide`.
- Access stays the GM's decision: a player still sends `asset-request`; the GM client checks it
  exactly as today (`AssetAnswers`), uploads the (variant) image if the server lacks it, and
  answers `asset-ticket {hash, url, expires}` (`url` a path on the server's origin,
  `/api/assets/{sha256}?t=<code>.<player id>.<expiry>.<mac>`; `expires` epoch milliseconds;
  `mac` = base64url HMAC-SHA-256 over code, player id, hash and expiry). The server reads the
  table from the ticket, rejects an expired ticket before computing the MAC, then compares the
  MAC in constant time. Tickets are valid for 120 seconds. The
  signing key is 32 random bytes made at the server's first start and kept in its state file,
  separate from `HOST_KEY` and table secrets; deleting it invalidates all tickets. The ticket is
  never a substitute for the GM's check: no ticket, no image.
- A ticket is a bearer URL for its lifetime: a player could pass it on, as they could pass on a
  screenshot; this is accepted, and the short expiry bounds it. Tickets are never logged.
- Download: `GET /api/assets/{sha256}?t=...` answers the bytes for a valid ticket, and the same
  `404` for a bad or expired ticket and for an unknown hash (no oracle). Headers: the sniffed
  `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` (the app
  keeps images in IndexedDB itself, so no ticketed URL is ever a browser cache key),
  `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy:
  same-origin`. No `Origin` requirement (image loads send none).
- The upload routes are authenticated by the table secret and not origin-checked; they are
  rate-limited per client address (60 part requests per minute), allow at most 4 unfinished
  uploads per table, and delete parts of an upload not completed within 1 hour.
- The player app verifies the SHA-256 and keeps the bytes in IndexedDB by hash, so a later visit
  needs no ticket. It falls back to the socket chunks when an upload or download fails, with the
  log line "图片改由主持人直接发送 / Image sent by the GM directly".
- A table's images are deleted when the table ends or is deleted (6.2: unhosted for 14 days).
- Note text of 6.4 stays on the socket path (small, and gated per chunk).

## 7. Milestones and plans

One design, three implementation plans:
- Plan 1: M0 (policy, contract doc, workspace layout), M1 (plugin settings, host key, online UI in
  Chinese), M2 (relay with conformance tests), ending with an end-to-end test: the GM's real
  `OnlineControl` against the real relay and a headless player client.
- Plan 2: M3 (player app: join, scene without lighting, log/chat, dice, initiative), M4 (lighting
  and vision, moving own tokens, image cache of 6.7).
- Plan 3: M5 (shared notes), M6 (deployment on the Hetzner VPS behind Cloudflare Tunnel, amended
  2026-10-28, and a real test game on phones in mainland China).

## 8. Testing

- Relay: conformance tests for every contract rule (handshake, timeouts, ping, close codes, gate,
  routing, size and rate limits, Origin), using the patterns of the local `FakeSocket` classes in
  `tests/unit/online/gm/tableConnection.test.ts` and `fakeTable.ts`, against the relay in-process.
- Player app: unit tests of reassembly, assets, deltas, pause handling, the your-turn alert and
  the gesture recogniser; a GM-side test that `gm`, `blind` and `self` rolls reach no other
  player's log or `people`, and that `your-turn` goes to the owner only and not on resyncs; fixture tests from GM-message corpora
  captured with `tests/unit/online/gm/shareHarness.ts` (it drives the real `SceneShare`); a check
  that a lit scene never draws the unlit map.
- Notes: the leak tests of 6.4.
- Image cache: ticket expiry, wrong player, wrong hash, forged HMAC, replay after expiry, uniform
  404, oversized and wrong-type uploads, interrupted and resumed uploads, disk caps, and that a
  player never gets an image without a GM-issued ticket.
- End-to-end: the real `OnlineControl` (as in `survivesReloads.test.ts`) with the real relay and a
  headless player.
- Manual: a test game on phones in M6.

## 9. Left to the builder

(Also: exact low-power thresholds, banner styles, vibration pattern.)

Workspace tooling, file structure inside `apps/`, persistence format, UI layout within the
phone-first rule, Markdown and sanitiser libraries, systemd vs container.

## 10. Open points for the user

- Settled: GM and players are in mainland China (hence 6.5 and 6.7). Production: the Hetzner VPS
  at `play.xinsawi.com` behind Cloudflare Tunnel (user decision 2026-10-28, replacing Alibaba
  Cloud); Alibaba Cloud only if the M6 phone test shows the tunnel unusable from the mainland.
