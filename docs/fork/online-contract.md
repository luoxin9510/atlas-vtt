# Atlas Online: GM-client contract (for a self-hosted relay + player app)

Repo: /Users/nuckcole/Developer/atlas-vtt. All paths below are relative to it. Line numbers verified against the working tree.
Read-only investigation. "UNSURE" marks anything inferred (the relay/player source is NOT in this repo).

## 0. TL;DR

- The GM client talks to ONE relay origin (`RELAY_ORIGIN`) for tables + a small account surface, and to `ACCOUNTS_ORIGIN` for the device sign-in. Both are `export const` (src/app/online/gm/servers.ts:2,5), with a third cosmetic URL `ACCOUNT_PAGE_URL` (servers.ts:8).
- The relay is a (nearly) dumb pipe with auth + join-gate logic: it forwards opaque JSON game bodies GM <-> players, never reads them (src/app/online/protocol/relay.ts:173 "The body of a send is left unread"). All game state, fog/vision filtering, movement validation, dice, seat/ownership, assets live in the GM client.
- The player web app is NOT in the repo (only references). The shared protocol/ + engine code was clearly designed to be consumed by it (and by the relay).
- Smallest plugin change: make the two origins configurable; and EITHER implement 4 trivial account endpoints on the server that auto-approve (zero extra plugin change) OR add a token bypass in AccountControl.

## 1. Network calls (complete inventory)

The tests pin the set of relay paths: `/api/me`, `/api/tables`, `/api/tables/` (tests/unit/online/noKeys.test.ts:60-63) and token handling (noKeys.test.ts:43-50).

### 1.1 HTTP (all via Obsidian `requestUrl`, `throw:false`; src/app/online/gm/account/obsidianHttp.ts:13-41)
`Http` interface: GET|POST, optional `authorization` header, `form` (urlencoded) or `json` body (src/app/online/gm/account/http.ts:2-26). Only header ever sent: `Authorization: Bearer <token>` (obsidianHttp.ts:20). Content-type from `bodyOf` (http.ts:22-26). Response is parsed as JSON or null (obsidianHttp.ts:29-34). Status 0 / 429 / >=500 are console-warned (obsidianHttp.ts:36-39). No CORS issue (requestUrl).

| # | Call | Origin | Caller | Needs token? |
|---|------|--------|--------|--------------|
| H1 | `POST /api/tables` | RELAY | src/app/online/gm/createTable.ts:19 | YES (Bearer) |
| H2 | `GET /api/me` | RELAY | src/app/online/gm/account/relayAccount.ts:75,86 (called from AccountControl.ts:127) | YES |
| H3 | `POST /auth/device/code` | ACCOUNTS | src/app/online/gm/account/deviceFlow.ts:40 | no |
| H4 | `POST /auth/device/token` | ACCOUNTS | deviceFlow.ts:59 | no |
| H5 | `POST /auth/sign-out` | ACCOUNTS | relayAccount.ts:96 | YES |
| H6 | `POST /api/reports` | RELAY | src/app/online/gm/companionDiagnostics.ts:56 (path const protocol/diagnostics.ts:10) | no; opt-in only |
| H7 | `POST /api/feedback` | RELAY | companionDiagnostics.ts:90 (diagnostics.ts:11) | no; user-initiated only |

#### H1 `POST {RELAY}/api/tables`
- Request: `Authorization: Bearer <account token>`, JSON `{ code: <campaign link>, gmLevel: GM_LEVEL(=7) }` (createTable.ts:19; asserted tests/unit/online/gm/createdTable.test.ts:47-48). `code` is CLIENT-CHOSEN: the campaign's lasting "link" = 26 chars base32 (`newLinkCode`, src/app/campaigns/players/playersFile.ts:159), kept in the campaign players file (src/app/online/gm/campaignSeats.ts:141).
- Success: HTTP **201** and JSON `{ code, secret, maxPlayers? }` (createdTable.ts:36-42). `code` must match `/^[a-z2-7]{26}$/` (protocol/relay.ts:12); `secret` must be a string, length >= 32 (createdTable.ts:40); saved-table reader also requires `SECRET_PATTERN` `/^[A-Za-z0-9_-]{16,128}$/` (relay.ts:166, savedTable.ts:31). So: base64url, 32..128 chars. `maxPlayers` int 1..12, else defaults to 12 (createdTable.ts:15-17).
- **The returned `code` MUST equal the requested `code`**. If it differs the client treats it as a stray table, opens a socket and ends it, then fails with "could not open this campaign's link" (tableStart.ts:58-62, 44).
- Error statuses handled (createdTable.ts:23-33): 401 -> signed-out (token cleared; tableStart.ts:65); 403 + `{error}` in `no-access|access-ended|access-revoked|account-restricted|terms-not-accepted` (relayAccount.ts:21) -> text; 409 `{error:'link-taken'}`; 426 `{minLevel}` (createTable.ts:22); 429; 503 `accounts-unreachable` | `not-configured`; anything else generic. 403 also triggers `account.refresh(true)` (tableStart.ts:66).
- Server-side semantics the client assumes (UNSURE, inferred from comments): relay asks the account service whether the account may host (createTable.ts:15-16 doc); one live table per account ("superseded", CLOSE.superseded 4016, tableEnd.ts:13-14); link bound to the creating account ("link-taken" 409); re-POST of the same link after the GM stopped a table must work (campaign's link is reused: tableStart.ts:47-52, tests/unit/online/gm/nextTableLink.test.ts).
- NOT called on resume after an Obsidian reload: the saved `{code, secret}` is replayed straight to the socket (OnlineControl.ts:129-140, OnlineFeature.ts:194). So the relay must keep tables + secrets durable across GM disconnects (relay "closes tables nobody hosts" after some time, strayTable.ts:5; UNSURE how long).

#### H2 `GET {RELAY}/api/me`
- `Authorization: Bearer`. Called on layout-ready when a token exists (OnlineFeature.ts:196) and when the dock opens (10 s freshness, AccountControl.ts:22,59-65), and after a 403 on create.
- 401 -> token forgotten + notice (relayAccount.ts:55, AccountControl.ts:129). 0/429/5xx -> "unreachable". 200 body `{ account:{id,handle,name}, access:{plan,maxPlayers,endsAt?} }` or `{ account, access:null, reason }` (relayAccount.ts:74-82, 38-51). Any other 200 shape -> 'unavailable' -> shown as unreachable (AccountControl.ts:130).
- This call is informational (dock label "Signed in as ... plan"); it does NOT gate Start. Start is gated only by `account.token() !== null` (tableStart.ts:34) and the relay's 201 on H1.

#### H3 `POST {ACCOUNTS}/auth/device/code` (RFC 8628)
- form `client_id=atlas-obsidian` (deviceFlow.ts:5,40). Response 200 JSON: `device_code` str, `user_code` str, `verification_uri_complete` (http/https URL, opened with `window.open`, OnlineFeature.ts:90), `expires_in` num, `interval` num secs (default 5, clamped 1..60 s) (deviceFlow.ts:38-52).

#### H4 `POST {ACCOUNTS}/auth/device/token`
- form `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=..&client_id=atlas-obsidian` (deviceFlow.ts:59). Poll every `interval`. 200 `{access_token}` -> done. Errors by `error` field: `authorization_pending`, `slow_down` (+5 s), `access_denied`, `expired_token`/`invalid_grant`; 5xx -> retry (deviceFlow.ts:60-71). Token is an opaque string.

#### H5 `POST {ACCOUNTS}/auth/sign-out`: Bearer; 200 = ok; failure is ignored (relayAccount.ts:94-101).

#### H6/H7 diagnostics: see section 7.

### 1.2 WebSocket (the GM <-> table link)
- URL: `wss://{RELAY host}/api/tables/{code}/socket` (`socketUrl`, TableConnection.ts:57-59; http->ws replace so `http://` origin gives `ws://`). Created with `new WebSocket(url)` in Obsidian's renderer (Electron/Chromium): NO subprotocols, NO custom headers, NO query string, no auth in the URL (TableConnection.ts:116). Browser sends `Origin: app://obsidian.md` (UNSURE; do not origin-check the GM socket).
- Framing: **text frames only**; binary is ignored (`typeof event.data === 'string'`, TableConnection.ts:129). JSON, every frame has `"v":1` (`PROTOCOL_VERSION`, relay.ts:9), `"t":<type>`.
- Keep-alive: client sends the bare text `ping` every 30 s after welcome (KEEPALIVE_PING/MS, relay.ts:21-23; Pulse.beat socketWatch.ts:134-142); relay must answer bare text `pong` (relay.ts:22; TableConnection.ts:258-260). ANY inbound frame counts as proof of life. Dead if no frame within 20 s of a ping that left the buffer (PULSE_DEADLINE_MS socketWatch.ts:14). The ping is not rate-limited by the relay (socketWatch.ts:71-73; hosted relay answers it from the edge "auto-response").
- Timeouts: socket must open within 10 s (OPEN_TIMEOUT_MS socketWatch.ts:5), welcome must arrive within 8 s of hello (WELCOME_TIMEOUT_MS :7), else the try is abandoned and retried.
- Handshake: on open client sends `{"v":1,"t":"hello","role":"gm","secret":<secret>,"level":7}` (TableConnection.ts:125). The relay must answer with `{"v":1,"t":"welcome","role":"gm","players":[{id,name}...] , waiting?:[{id,name}], batch?:true, minLevel?:n}` (parse: relay.ts:246-256; the `players` key is MANDATORY: absent -> frame rejected, relay.ts:247-248). Then, in this order (TableConnection.ts:263-277): client sends `gate` frame and `players` frame (roster) immediately, attaches the send queue, then fires `welcome` so everything is re-sent to connected players.
- Reconnect: on any close/error/timeout -> exponential backoff `min(30 s, 500ms * 2^attempt) * (0.5..1.0 jitter)` (backoff TableConnection.ts:42-44, failed :313-327), forever, unless the close code is final. Final (no retry, status 'refused'): 4001 badSecret, 4007 version, 4008 ended, 4002 replaced, 4009 kicked, 4015 noAccess, 4016 superseded, and the gate codes 4010-4014 (relay.ts:30; FINAL_CLOSE_CODES). Other 4003-4006 and 1006 etc. retry. Meaning of codes: relay.ts:37-54. `tableEndOf` maps 4002/4015/4016/4007 else 'refused' (tableEnd.ts:16-22): 'refused' ends the table and DROPS the saved table (OnlineControl.ts:315-317), so only close with a final code when the table is really gone.
- Stop: `end()` sends `{"v":1,"t":"end"}` then closes 1000 (TableConnection.ts:219-229). Relay must delete the table on `end`.
- Rate limits the client self-throttles to: 80 frames/s sustained, burst 40, relay limit assumed 100/s burst 200 (sendQueue.ts:10-13); socket buffer caps 1 MiB (live) / 64 KiB (bulk) (:15,20). Relay-side limit close code 4005 rateLimited (relay.ts:41). Max GM frame 320 KiB (`MAX_GM_FRAME`, relay.ts:26) -> relay must accept >= 320 KiB text frames from the GM and >= `MAX_STREAM_LINE` for the stream lane. Max player frame 4 KiB (relay.ts:30), also for a socket that has not said hello; 4004 tooLarge.

### 1.3 Frames the GM sends the relay (`ClientFrame`, relay.ts:114-124; parser `parseClientFrame` relay.ts:174-210, meant for the RELAY side)
- `{t:'hello', role:'gm', secret, level}`
- `{t:'send', to:<playerId|'*'>, body:<GmMessage>}` (to one player or all connected; TableConnection.ts:51 builds it; `ALL_PLAYERS='*'` relay.ts:15)
- `{t:'sends', sends:[{to,body}...]}` 1..64 entries (MAX_BATCH_SENDS relay.ts:28, parseSends relay.ts:212-221) ONLY if the relay's welcome said `batch:true` (TableConnection.ts:271; SendQueue.takeBatch sendQueue.ts:146-165). Each entry must be handled "as its own send would be". Without `batch` each message is its own `send` frame.
- `{t:'kick', id}`, `{t:'admit', id}`, `{t:'decline', id}` (id = 20-char base32 player id, relay.ts:6/identity.ts:6)
- `{t:'gate', code:<6 digits|null>, ask:boolean}` (TableConnection.ts:192, joinGate.ts:21-25, 50)
- `{t:'players', players:[{id,name,code}]}` the campaign's whole roster, <= 64 seats, unique id and code, code = 6 digits (protocol/seat.ts:4-25; sent TableConnection.ts:199-204, 292-294)
- `{t:'end'}`
Only sent while a player is connected: game messages are suppressed locally when nobody is connected (TableConnection.ts:152-156,181-183).

### 1.4 Frames the relay sends the GM (`RelayFrame`, relay.ts:127-156; parser `parseRelayFrame` relay.ts:242-290; handled TableConnection.ts:257-290)
- `welcome(role gm)` (above); `player-joined {id,name}`; `player-left {id}`; `knock {id,name}` (a newcomer waiting for approval); `knock-gone {id, full?:true}`; `gate-paused {until:ms epoch of relay clock}`; `access {closesAt:number|null}` (only used for the account-expiry feature; never needed); `game {from:<playerId>, body}` (relay stamps `from`; TableConnection.ts:289). `game` without `from` is dropped on the GM side.
- Unknown `t` or malformed -> silently ignored (parse returns null).

## 2. Table lifecycle

1. GM presses Start (needs an active Atlas map tab, a played campaign, and a token): `startBlock` (tableStart.ts:31-35) -> `createCampaignTable` (tableStart.ts:53-68): reads campaign players file, gets-or-makes the 26-char link, `POST /api/tables` (H1).
2. `new OnlineTable(app, RELAY_ORIGIN, saved,...)`; join link = `${origin}/#${table.code}` (OnlineTable.ts:81) -> **the relay origin itself must serve the player web app at `/`, reading the table code from the URL fragment**. Dock shows it + a QR (tests/unit/online/gm/qrDrawing.test.ts). GM data (code, secret, campaign id, map path, gate) is persisted locally in `atlas-vtt/.atlas-data/online.json` (savedTable.ts:9-22; PRIVACY.md:"On this device") and replayed after reload.
3. Socket connect + hello (section 1.2). On welcome the client: sends gate + roster, re-sends the whole scene state to connected players (OnlineTable.ts:166-174 -> `resend`).
4. Join gate (joinGate.ts, TableGate): GM holds `{code: 6 digits, requireCode, askToJoin}`; defaults both on (joinGate.ts:33). GM tells relay `gate {code|null, ask}` on every welcome and change. Relay decides everything (joinGate.ts:100-103 doc "The relay decides everything"): newcomer must present the join code (else close 4010 wrongCode; repeated wrong codes -> `gate-paused` to GM + close 4011 `paused`, pause is 10 min max, joinGate.ts:28); if `ask`, relay sends `knock` to GM and `waiting` to the newcomer; GM `admit` -> player gets `welcome`, GM gets `player-joined`; `decline` -> 4012; no answer -> 4013; too many knocks -> 4014; table full -> `knock-gone{full:true}` / 4003. MAX_WAITING 8, MAX_PLAYERS 12 (relay.ts:32-34). The GM client has an "arm" delay before a card can be answered (ARM_MS joinGate.ts:7).
5. Seats / campaign seats: a campaign has permanent players `{id,name,code}` (6-digit own code), stored in the campaign's players file on the GM side (campaignSeats.ts, tableRoster.ts). GM pushes the whole roster to the relay (`players` frame); a returning player can enter their own 6-digit code (same field as the join code, identity.ts:7-8; tableRoster.ts:20,87) and the relay resolves it to their stable player id. A NEWCOMER who got in is made a campaign player by the GM client (tableRoster.ts:65-86): client mints them a code, re-sends `players`, then sends `your-code {code, first:true}` to that player (protocol/seat.ts:28-39). If the GM has no room it sends `kick`-like `turnAway` (tableRoster.ts:76-80).
6. Player hello (`PlayerHello`, relay.ts:79-89, parse :195-209): `{v,t:'hello',role:'player',name,key?,code?,waits?,wait?,newcomer?}`; `key` = player's saved secret key (returning player; bypasses gate), `code` = join code or own code; `waits/wait` = resumable wait token. Relay's reply `welcome(role player){id,key,gmOnline,gmLevel?}` (relay.ts:145), `waiting{wait?}` (:143), `gm{online,level?}` (:149), `player-joined`/`player-left` to others as needed. Relay mints the player `id` (20-char base32) and `key` (SECRET_PATTERN) for newcomers; known players keep their id (campaign roster id).
7. Kick: GM sends `kick{id}` -> relay forgets their key and closes their socket (TableConnection.ts:185-188; CLOSE.kicked 4009). Player can re-enter with their own code (OnlineControl.ts:168).
8. End: `end` frame (stop) -> relay deletes; or "new link" = stop + new link + POST again (OnlineControl.ts:203-220). Server-initiated ends use close codes 4002/4015/4016/4008.
9. GM offline: relay tells players `gm{online:false}`; players stay connected; when GM re-welcomes everything is re-sent (TableConnection.ts:73-74 doc, OnlineTable.ts:166-174).
10. Saved tables: only in GM-local data (savedTable.ts). Relay-side persistence needed: table(code, secret hash, account, maxPlayers), gate (code hash, ask), roster (id,name,code), player keys, waiting list. The `players` and `gate` frames are re-sent on every welcome (TableConnection.ts:269-270), so the relay could rebuild those from the GM after restart; only code+secret+player keys must be persisted.

## 3. Account / auth

- Gate 1: experimental switch `onlinePlay` (src/app/experimental/experimentalFeatures.ts:16-20; command palette "Experimental features"). Wiring: src/app/plugin/onlinePlay.ts:34-55: `wanted = settings.isExperimentalOn('onlinePlay')`, `on = wanted && requireApiVersion('1.11.4')` (secret storage), then `new OnlineFeature(plugin, ...)` loaded as plugin child (onlinePlay.ts:50). Off => zero network (PRIVACY.md "Online play").
- Gate 2: signed in = a token in Obsidian secret storage under id `atlas-account` (tokenStore.ts:4, 22-34; no delete API, cleared = empty string). Obsidian < 1.11.4: signing in throws (tokenStore.ts:44-50) and the feature isn't loaded at all (onlinePlay.ts:39-43).
- Sign in: dock/settings "Sign in" -> `AccountControl.signIn` (AccountControl.ts:68-96): `DeviceSignIn` (H3, opens `verification_uri_complete` in the system browser, shows `user_code`, polls H4). On token: `tokens.set(token)` then `refresh(true)` (H2).
- Token use: ONLY `Authorization: Bearer` on H1, H2, H5 (noKeys.test.ts:43-50 enforces exactly two files write it: relayAccount.ts and createTable.ts). The table socket does NOT use the token (it uses the table `secret`). Running tables never depend on the token: 401 later only clears it and says "Running tables keep going" (accountView.ts:55, AccountControl.ts:114-119).
- Invite key: there is NO invite-key code in the plugin. It is "redeemed on the website account page" (AccountControl.ts:28-29; ACCOUNT_PAGE_URL servers.ts:8; accountView.ts:41 text). Tests forbid `/api/invites`, create keys, `mayHost` in the plugin (noKeys.test.ts:21-37). The invite requirement is purely the server answering 403 `no-access` on H1 (and `/api/me` with `access:null, reason:'no-access'`). So "skipping the invite" = the server just always returns 201 / access object.
- What breaks without a token: `startBlock` returns 'Sign in to host first.' (tableStart.ts:34), `startFor` refuses (OnlineControl.ts:270-272). Nothing else is gated (resume of a saved table works without a token).
- Plugin-side gate on server answers: none (the plugin trusts the relay: createdTable.ts:22 "Who may host is the server's word").

## 4. Assets (map images, token art, text): relayed on request THROUGH the GM socket; nothing is uploaded to the server

- Scene message carries `AssetRef {hash:sha256 hex 64, size, mime}` for the map (protocol/game.ts:22-32, asset.ts:3-4,17-21); tokens, explored mask, shown images, book art likewise (explored: game.ts:63, :148-152; text assets TEXT_MIME_TYPE `text/markdown` asset.ts:14).
- Player asks via a game body `{t:'asset-request', hash, from?:chunkIndex, maxSide?}` (game.ts:106-111, parser :274-280). GM answers only for hashes in that player's CURRENT picture (map, explored mask, token/initiative art, quest text): `AssetAnswers.answer` (src/app/online/gm/assetAnswers.ts:42-55) else `{t:'asset-refused',hash}` (:88-91).
- Reply = N messages `{t:'asset-chunk', hash, index, count, data:<base64>}` sent `to` that player (assetServe.ts:15-22; game.ts:51). Chunk = 192 KiB raw => exactly 256 KiB base64 (asset.ts:6-7). Max asset 64 MiB (asset.ts:9), so <= ceil(64Mi/192Ki)=342 chunks (game.ts:115). A download can resume from chunk `from` (assetAnswers.ts:44). `maxSide` (256..16384) => GM scales the image and sends `{t:'asset-variant', hash, maxSide, variant:AssetRef, width, height}` then chunks of the variant under its own hash (asset.ts:48-55, assetAnswers.ts:71-78). Client verifies via SHA-256 (token art re-hashed on GM side: assetAnswers.ts:66).
- Throttle: same (player,asset,chunk) repeat ignored for 10 s; max 3 serves per player+asset per 10 s (assetServe.ts:63-71, 79-105). A page must not hammer; re-ask only after 10 s.
- Large non-asset JSON (scene walls etc.) is split into `{t:'part', id, index, count<=64, data:base64}` of the UTF-8 JSON text, 192 KiB pieces (messageParts assetServe.ts:29-38; MAX_PARTS game.ts:35; parse :227-229). **Player-side reassembly of `part` is NOT in this repo** (the player app must concatenate pieces of one `id` in index order, base64-decode, UTF-8 decode, JSON.parse, parse as GmMessage).
- Audio: no audio is sent online (grep of protocol/ and gm/ found none besides `_audioDirty` flag).
- Consequence: relay stores no assets; the GM must be online to serve images; relay only needs to carry >= ~350 KiB frames. A relay could optionally cache by hash, but nothing in the protocol asks for it.

## 5. Message catalogue (body of `send`/`game` frames)

Parsers live in src/app/online/protocol/game.ts. `parseGmMessage` (game.ts:197-254) = what a PLAYER APP uses to read GM messages; `parsePlayerMessage` (game.ts:257-272) = what the GM client uses to read player messages (SceneShare.ts:215, FoundShare.ts:68, bookAssetDesk.ts:23); a relay could also use it to validate but the GM already does. `parseClientFrame` is for the relay; `parseRelayFrame` is used by BOTH GM client (TableConnection.ts:261) and a player app. `StreamReader`/`streamSendBody`/`parseStreamSend` serve the SSE lane (section 5.4).

### 5.1 GM -> player (`GmMessage`, game.ts:37-93) payload pointers
- `scene {scene: {id,map:AssetRef|null,lit}|null}` (game.ts:22-32)
- `tokens {scene,seq?,tokens:SharedToken[],cell,snap}` (tokens.ts; limits MAX_TOKENS 500 tokens.ts:6); `mine {scene,tokens:ids,dice?}` (to one player: which tokens are theirs; game.ts:50, 213-219)
- sequenced + deltas: `tokens`, `sight`, `fog` carry `seq`; `delta {of,scene,seq,lists?,set?,unset?}` applies to the previous (protocol/delta.ts:1-50). Player rule: keep last; delta with `seq == held.seq+1` applies; `<=` ignore; else 'gap' -> send `{t:'resync',scene,of}` (deltaReader.ts:1-40, game.ts:96-100). **`DeltaReader` is in protocol/ and is ready for a player app.** GM answers resync at most 1/s per player (sequencedList.ts:8, 62-68).
- `fog {scene,seq?,fog:SharedFog}` (fog.ts; MAX_FOG_OPERATIONS 5000), `lighting {scene,...}`, `sight {scene,seq?,...}` (lighting.ts), `live` (fast lane for dragged tokens; live.ts:36; sent via sendLive with replace-by-key, TableConnection.ts:174-178), `explored {scene,mask:AssetRef(png)|null}`, `grid`, `doors`, `sensed`, `pins`, `annotations`, `initiative {scene,list|null}`, `widgets {scene,bar|null}` (mapLayers.ts, initiative.ts, widgets.ts; MAX_COMBATANTS 200)
- `rules {scene,...}` (rules.ts:41), `roll` (a roll result, dice.ts:62), `roll-refused` (dice.ts:142), `move-refused {scene,id,x,y|null,reason?:'turn'}` (moves.ts:53,89-95), `marks` (lasers/measures/cursors of others, marks.ts:101), `shown-image` (image.ts:21)
- Table log/chat: `log`, `log-entry`, `log-remove`, `chat-refused`, `people` (log.ts:164-169, logParse.ts:184-196; MAX_LOG_ENTRIES 200, MAX_CHAT_TEXT 500 log.ts:11-14), plus `your-code` (seat.ts:28-39)
- Character book (per-player sheet/items/notes): `book`, `book-sheet`, `book-item`, `book-note`, `book-note-delete`, `book-pin`, `book-pin-delete`, `book-purse`, `book-token`, `book-statblock`, `book-rest-answer` (book.ts:99-127,235; bookRest.ts:127). Wire-size guard for player->GM book messages: 4 KiB incl. envelope (bookText.ts:40).
- Assets: `asset-chunk`, `asset-refused`, `asset-variant`, `part` (section 4).

### 5.2 Player -> GM (`PlayerMessage`, game.ts:113)
`asset-request`, `resync`, `move {scene,id,x,y}` (moves.ts:17-23), `drag` (live drag, latest wins), `drag-cancel`, `roll` (dice.ts parsePlayerRoll: formula <=160 chars, advantage; protocol level 6), `laser`/`measure`/`cursor` (marks.ts:82-91), player log messages `chat`, `chat-edit`, `chat-delete`, `react` (log.ts:173-189; isPlayerLogType), `pin-found` (mapLayers.ts), book messages (`isPlayerBookType`), `book-token`, `book-rest`, `book-parts`, `book-cover`. Every player->GM frame must be <= 4 KiB (relay.ts:30).

### 5.3 Authority: where logic lives (matters for a self-hosted relay)
- Visibility is GM-side: the GM computes per-player tokens/fog/sight/lighting and sends only what that player may see (comments: game.ts:21-25, SceneShare/TokenShare; tests tokenLeak.test.ts, inputLeak.test.ts, marksLeak.test.ts, mapLayersLeak.test.ts). The player app merely draws what it is sent (lit scenes: "players see only what the lighting shows them, worked out from lighting and sight", game.ts:28-31).
- Movement validated GM-side (src/app/online/gm/moveCheck.ts, playerMoves.ts, protocol movement/wallCollision shared), dice rolled GM-side (RollShare/PlayerRolls; player sends a formula, GM replies `roll`), chat commands/rest/log GM-side (TableLog), asset serving GM-side, seat ownership GM-side (ownership.ts).
- Relay stamps `from` on player->GM and strips it on GM->player; it does no body validation.

### 5.4 Is protocol/ shareable with a player app?
- Yes by design. All imports use explicit `.ts` extensions (e.g. protocol/index.ts:1-33), no obsidian imports. `scripts/boundaries.mjs` group `shared` lists `src/app/online/protocol/**`, `marks/**`, `movement/**`, `tableLog/**` plus lighting/fog/vision/grid/gameSystems/types/dice3d/i18n/primitives/pixi lighting engine etc. (scripts/boundaries.mjs:2-40ff). A second group `mayImport:["shared"]`+npm packages (clipper2-ts, pixi.js, pixi-filters, pixi-viewport, react, react-dom, framer-motion, three, lucide-react, @radix-ui/*, zustand, immer...) is the player app's allowed surface (boundaries.mjs tail). `tsconfig.shared.json` type-checks the shared set with the `obsidian` module forbidden (tsconfig.shared.json:3-14; `check:boundaries` package.json:27). tests/unit/dependencyBoundaryEnforcement.test.ts:13-18 asserts shared code cannot use fetch/XMLHttpRequest/WebSocket/localStorage/indexedDB/node/obsidian. => shared code runs in browser, worker (Cloudflare Worker/Deno/Node) and is deliberately transport-free.
- Comments confirm consumers: `build.ts:1` ("builds of the client and the companion ... absent in tests and the relay"), `relay.ts:159-160` (`apps/play/src/install/seatCookie.ts`), `stream.ts:1-10` (player-side stream fallback). So upstream is a monorepo with `apps/play` (player page), a relay (Cloudflare Durable Object: relay.ts:21-22 "Durable Object's auto-response", TableConnection.ts:65-68 "Durable Object hibernates") and the companion/plugin. This repo is the plugin-side extract; `apps/play`, relay, `vite.base.mts` are absent (verified: `rg "apps/play|vite.base"` finds only these two comment references).
- Not shared/absent (player must write): part reassembly, WS client with hello/reconnect, asset downloader + cache, renderer glue, chat UI composition beyond `tableLog/` React components (TableLogPanel.tsx, Composer.tsx exist in shared tableLog/), seat cookie/service worker (SEAT_PATH relay.ts:163).
- Other shared constants a relay must honour: ids/patterns (identity.ts:6-8, relay.ts:12,166), name sanitiser `playerName` (identity.ts:28-32, max 32 chars), `PROTOCOL_VERSION=1` (other versions closed with 4007 via `isOtherVersion` relay.ts:236).

### 5.5 Stream lane (player fallback when WebSocket is blocked; GM never uses it) (protocol/stream.ts)
Down: `POST /api/tables/{code}/stream` with the hello as body (<=16 KiB), response `text/event-stream`: first `event: session` data=secret, then default-event `data:` lines per relay frame, `event: pong`, `:` beat comments every 15 s, final `event: close` `{code,reason}` (stream.ts:13-48). Up: `POST /api/tables/{code}/stream/send` JSON `{v:1,s:<session secret>,frames:[string<=32],ping?,bye?}` body <=64 KiB (stream.ts:15-26,108-129). Optional for an MVP; a WebSocket-only player is enough.

## 6. Test harnesses / player-side code in the repo

There is NO real relay and NO player app. What exists (all vitest, `npm test` = `vitest --project unit`, package.json:16):
- tests/unit/online/gm/fakeTable.ts:13-60 `FakeSocket`: records every frame the GM sends (`sent`, `frames()`, `bodies()`), `relay(frame)` injects relay frames (`{v:1,...frame}`), `closeWith(code)`. Auto-opens on a microtask. Plus fake Atlas tabs/vault/PNG generator (fakeTable.ts:62-224). This is the best template for a **conformance test of our relay**: replace FakeSocket with a real socket against our server.
- tests/unit/online/gm/tableConnection.test.ts:1-80,122-480: a second FakeSocket (EventTarget) + fake timers; documents precisely handshake/welcome/ping/timeouts/backoff/batching/gate/roster (describe blocks at :122, :257, :430). Executable spec of section 1.2.
- tests/unit/online/gm/survivesReloads.test.ts:20-62 mocks `obsidian.requestUrl` returning a canned `{status:201,json}` for H1 (fixture `SAVED` :63-65) and runs the whole `OnlineControl` against FakeSocket (:349-361 URL assertions).
- tests/unit/online/gm/createdTable.test.ts:15-48 (all H1 status/error mapping), accountSignIn.test.ts:67-70,110,127,200 (fake account+relay HTTP server for H2/H3/H4/H5 with exact request shapes), companionDiagnostics.test.ts:15,67,114 (H6/H7), obsidianHttp.test.ts.
- tests/unit/online/gm/shareHarness.ts:35-183 **shareHarness**: builds the REAL `SceneShare` (the GM's per-player scene publisher) over a fake Atlas store, renderer, vault and clock, capturing every `{body, to}` it would send (`sent`), with `advance(ms)` timers. It also includes the player-side helpers `sequenced()`/`tokenLists()` which run `DeltaReader` + `parseGmMessage` over the captured messages "as a player's browser reads them" (shareHarness.ts:172-183). Great for generating a GM-message corpus (golden fixtures) to drive/test the player app WITHOUT Obsidian. controlHarness.ts:65-88 wraps it with Atlas's real view store. bookTableHarness.ts, fakeSeats.ts, markHarness.ts similar.
- tests/unit/online/protocol/*.test.ts (messages.test.ts, stream.test.ts, level.test.ts, ...) test the shared parsers; messages.test.ts is the most useful for player payload shapes.
- Player-side behavior in repo: only `DeltaReader` (protocol/deltaReader.ts), `StreamReader` (stream.ts:64-101), remote marks renderers (src/app/online/marks/* RemoteCursors/RemoteLasers/RemoteMeasures/RemoteDrags are PLAYER-visible overlay renderers used by both), `tableLog/` React UI, `movement/wallCollision`.

## 7. Error reports, feedback, other calls home

- Diagnostics (companionDiagnostics.ts): `POST {RELAY}/api/reports` (ErrorReport JSON, only if GM enabled "Send error reports", off by default; enabled flag OnlineFeature.ts:119; body limit 8 KiB diagnostics.ts:18; rate 5/min errorReporter.ts) and `POST {RELAY}/api/feedback` (FeedbackPost `{v:1,source:'companion',text<=2000,diagnostics|null}`; result: 2xx = sent, 429/503 = busy, else failed, diagnostics.ts:251; tests return 201 for feedback and 202 for reports, companionDiagnostics.test.ts:15). No auth header. Can be left unimplemented: `postJson` uses `requestUrl` with throw:false (companionDiagnostics.ts:24-27); a 404 just means "failed"/ignored (UNSURE whether a thrown network error is swallowed by ErrorReporter; feedback path catches, :91-93).
- Unrelated to online play but "calls home": issue reporter POST to `https://srv1871379.hstgr.cloud/atlas/reports` (src/app/support/IssueReporter.ts:18; submitter issueSubmission.ts:15-45), update check GET `https://raw.githubusercontent.com/atlas-vtt/atlas-vtt/HEAD/manifest.json` (src/app/updates/publishedVersion.ts:6), opens the browser to `verification_uri_complete` and `ACCOUNT_PAGE_URL`. Discord/GitHub links in communityLinks.ts. No telemetry otherwise (PRIVACY.md:1-10).
- Persisted per-origin state: `gmLevel.ts:18-26` stores min-level keyed by `RELAY_ORIGIN` in localStorage (if origin becomes dynamic this works automatically if it reads the dynamic value).

## 8. Feasibility verdict

### 8.1 Verdict: FEASIBLE and relatively small on the server side; the PLAYER APP is the large effort.
The relay is a thin stateful router. All the hard game logic is on the GM side and already written; the wire protocol is JSON, versioned, strictly parsed, with shared TS parsers. Confidence high for the relay, medium for the player app (no reference implementation in repo).

### 8.2 Minimal relay (Node/Deno/Bun + `ws`, or Cloudflare DO; ~600-900 LOC)
HTTP:
1. `POST /api/tables` -> 201 `{code,secret,maxPlayers}` echoing the requested `code` (validate `/^[a-z2-7]{26}$/`, `gmLevel`), mint secret (>=32 chars base64url). No-auth variant: ignore Authorization or accept any bearer. Keep link->secret map; re-POST by "same owner" must replace the secret (and close an older GM socket with 4002 `replaced`).
2. `GET /api/me` -> 200 `{account:{id,handle,name},access:{plan:'host',maxPlayers:12}}` (optional but avoids the "unreachable" label).
3. (If using auto-approve account service) `POST /auth/device/code`, `POST /auth/device/token`, `POST /auth/sign-out` + a tiny approve page (can auto-approve): see 8.4 option A.
4. `POST /api/feedback` and `/api/reports`: stub 202/204 (optional).
5. Static hosting of the player app at `GET /` (join link is `${origin}/#${code}`), plus `GET /__atlas-online-seat` stub (relay.ts:163; optional).
WebSocket `/api/tables/{code}/socket` (text frames, JSON):
- Text `ping` -> `pong` (any socket).
- First frame must be hello; `isOtherVersion` -> close 4007; size limits (player 4 KiB, GM 320 KiB, else close 4004); GM hello: check `secret` -> else 4001; reply `welcome{players,waiting?,batch:true,minLevel?}`; tell players `gm{online:true}`; a second GM hello with the right secret replaces the first (old gets 4002).
- Store per table: secret, gate `{code|null, ask}` (from `gate` frame; hash it), roster (from `players` frame), player records (id, name, key), connected sockets, waiting knocks, wrong-code counters/pause.
- Player hello: (a) `key` known -> welcome with same id/key; (b) `code` equal to a roster seat code -> welcome that seat id (mint/reuse key); (c) newcomer: if gate.code set then require equal else close 4010; count failures -> pause (4011 + `gate-paused` to GM); if `ask` -> `knock` to GM + `waiting` to player; GM `admit` -> welcome + `player-joined`, `decline` -> 4012; timeout -> 4013; seat limit (`maxPlayers`) -> `knock-gone{full}`/4003. Exact timings and unique rules UNSURE (not in repo): choose sane values (knock timeout ~2-5 min, 5 wrong codes -> 10 min pause).
- Routing: player `send{body}` -> GM as `{t:'game',from:<id>,body}`; GM `send{to,body}` / `sends[]` -> `{t:'game',body}` to that player or all connected; GM `kick` -> close 4009 + forget key; `admit/decline`; `end` -> close all with 4008 and delete table; `gate`/`players` update state; disconnect GM -> `gm{online:false}` to players; disconnect player -> `player-left` to GM; first `welcome` to GM lists connected players.
- Rate limit optional (client already self-limits to 80 fps).
Persistence: only table code/secret/gate/roster/player keys need to survive restarts (GM re-sends gate+roster on every welcome, TableConnection.ts:269-270).

Hard/awkward spots (flag): (1) join-gate state machine incl. knocks + wait tokens + pause, which is the only real server logic (joinGate.ts doc); (2) frame sizes (320 KiB+; ws `maxPayload` must be raised); (3) back-pressure: asset chunks of 256 KiB fan out per player through the relay, memory grows with 12 players * 64 MiB assets; (4) idempotent `POST /api/tables` semantics and link ownership (UNSURE what the official relay does when the same link is POSTed while a table exists); (5) gate/roster must be hashed/stored minimally; nothing else is validated server-side, so the server cannot protect against a hostile GM (n/a).

### 8.3 Player app MVP (what it must implement; the GM does the rest)
Required protocol pieces: WebSocket client with hello (name, key from localStorage, code) -> welcome -> keep `key`; ping every 30 s; reconnect with backoff; handle the final close codes and gate codes (relay.ts:30,37-54); `waiting` UI; `gm{online}`; `parseRelayFrame` + `parseGmMessage` + `DeltaReader` (+ send `resync` on gap); `part` reassembly; asset downloader (request `asset-request`, collect `asset-chunk`s in order, base64 decode, verify SHA-256 hash, handle `asset-refused`, 10 s re-request limit, optional `maxSide` variants); stable per-player name sanitiser `playerName`.
MVP feature -> messages:
- See map with fog/vision: `scene`, map asset, `tokens`(+delta), `fog`(+delta), `sight`(+delta), `lighting`, `explored`, `grid`, `doors`, `sensed`, `annotations`, `pins`. Rendering reuse: shared lighting/fog/vision/pixi engines are already in the `shared` boundary (pixi lighting engine, fog, vision, grid, lighting; boundaries.mjs:2-40) so the renderer can import them; the pure drawing/camera/UI glue of upstream `apps/play` is absent and must be written (large part; likely pixi.js + the shared lighting engine; lit scenes require the engine because the GM sends sight/lighting inputs, not pixels).
- Move own token: read `mine`, send `move`/`drag`/`drag-cancel`; handle `move-refused`; use `movement/wallCollision` for client prediction (optional).
- Roll dice: send `roll`; read `roll`/`roll-refused`; formulas parse via shared tools/*.
- Chat/log: `log`/`log-entry`/`log-remove`/`people` and `chat`/`chat-edit`/`chat-delete`/`react`; React UI available in `src/app/online/tableLog/` (shared).
- Initiative: `initiative` message (list or null).
- Shared notes: `book`/`book-note*`/`shown-image`/`pins`+`pin-found`/quest text assets (`text/markdown` asset).
- Join UX: link fragment code, name entry, join code field (also accepts own 6-digit code), `your-code` message (show/keep code).
Not needed for MVP: stream lane, character sheets/statblocks/rests, marks (laser/measure/cursor), widgets, 3D dice.
Protocol version coupling: GM_LEVEL=7 (protocol/level.ts:14); server may omit `minLevel`; player app should ignore unknown `t` (parse returns null).

### 8.4 Smallest plugin changes
A. **Make origins configurable** (required): `RELAY_ORIGIN`/`ACCOUNTS_ORIGIN`/`ACCOUNT_PAGE_URL` are `export const` in src/app/online/gm/servers.ts:2,5,8. Importers: tableStart.ts:8,58,60; OnlineControl.ts:16,293; account/AccountControl.ts:2,70,87,111,121,127; companionDiagnostics.ts:7,56,90,100; gmLevel.ts:3,19,25 (origin-keyed cache). Easiest: replace consts with a module-level `let`/accessor (`relayOrigin()`), set from a plugin setting (OnlineSettings, src/app/online/gm/settings.ts) at feature load (OnlineFeature.ts:132); ~6 files, <40 lines. Existing tests compare literal `https://play.atlas-vtt.dev/...` (createdTable.test.ts:47, accountSignIn.test.ts, survivesReloads.test.ts:349,361, onlineSettings.test.ts:92) and keep passing if the default is unchanged. `socketUrl` already derives wss/ws from the origin (TableConnection.ts:58); `http://` origin works for LAN (note `requestUrl` + Electron are fine; mixed-content only affects the player's browser).
B. **Account/invite bypass, two options**:
 - Option A (zero extra plugin code beyond origins): server implements H3/H4/H5/H2 so that device sign-in auto-approves: `/auth/device/code` returns a `verification_uri_complete` pointing at a local page (or at itself) and `/auth/device/token` returns `{access_token}` on first poll (or after one click). H1 accepts any bearer. Still requires Obsidian >= 1.11.4 (secret storage; onlinePlay.ts:39).
 - Option B (tiny plugin patch): in `AccountControl.token()` (account/AccountControl.ts:54-56) return a fixed placeholder string when a "self-hosted" setting is on, and skip `check()`/`refresh` (AccountControl.ts:59-65, 126-133) or let `/api/me` stub exist; `accountView` would otherwise show "checking/unreachable" (accountView.ts:31-38) but Start is not blocked by that. Also make `startBlock` (tableStart.ts:31-35) pass (it does when token() != null). Also hide or point `ACCOUNT_PAGE_URL`.
 - Not needed: invite key, `mayHost`; the plugin has none (noKeys.test.ts).
C. Optional: point diagnostics to own/no-op (companionDiagnostics.ts uses RELAY_ORIGIN, off by default); issue reporter (support/IssueReporter.ts:18) is unrelated.

### 8.5 Open questions (UNSURE; verify against the real service by black-box probing or by writing the conformance test from the harnesses)
1. Exact relay behaviours not in the repo: join-gate timings/limits, `waiting`/`wait` token semantics, how a player's own-code hello resolves, whether `welcome` to a player precedes `player-joined` to GM and what the GM expects first (the GM handles `player-joined` by sending state, TableConnection.ts:282-284 / OnlineTable.ts:175-181).
2. Semantics of H1 when the table already exists for that link/account (replace secret vs. reject), and how long an orphan table survives.
3. Whether the official relay enforces `Origin` on the GM socket (assume not needed).
4. Player id for known campaign players: the roster `players` frame carries ids minted by the GM (`newPlayerId`, playersFile.ts:162); relay must reuse them as the player's id when a player enters their own code.
5. `access` frame, `minLevel`, `gmLevel`, `batch` are all optional capabilities and may be omitted.
