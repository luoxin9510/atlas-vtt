# Self-hosted online play, Plan 1 (M0-M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM can host a table from the Atlas fork on the user's own relay server, with no upstream account, and a headless player can join it end to end.

**Architecture:** The plugin's Atlas Online client stays as it is, except that its server origins become a setting and a host key replaces the account token on a self-hosted server; its UI is translated. A new Node relay in `apps/relay/` implements the contract the client already speaks (HTTP `POST /api/tables`, WebSocket routing, join gate), reusing the shared `src/app/online/protocol/` parsers.

**Tech Stack:** TypeScript, Obsidian plugin API, vitest; Node >= 22.18 (runs `.ts` with type stripping, needed because `protocol/` imports with `.ts` extensions), `ws` 8.18.3.

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (sections 3, 6.1, 6.2, 6.5, 6.6, 7, 8). Contract details: `docs/fork/online-contract.md`.

## Global Constraints

- The server address defaults to empty: online play is unavailable until the user sets one; a fork build never contacts upstream on its own (spec 6.1).
- Self-hosted = an address is set and differs from `https://play.atlas-vtt.dev`. Then no account calls are made (`/api/me`, device sign-in, sign-out) and diagnostics post nowhere.
- Host key: Obsidian secret storage, id `atlas-host-key`; sent only as `Authorization: Bearer <host key>` on `POST /api/tables`.
- Relay limits (spec 6.2): secret 43 base64url chars, stored only as a hash, compared in constant time; `maxPlayers` default 8, valid 1-12; at most 10 tables; `POST /api/tables` 10 per minute, 5 wrong host keys lock it 10 minutes per client address; 20 sockets per client address; frames before an accepted GM hello at most 4 KiB, a welcomed GM socket up to 512 KiB, player frames over 4 KiB close 4004; player frame rate above 20/s closes 4005; knock waits 3 minutes (4013); 5 wrong codes in 10 minutes pause the gate 10 minutes (4011 + `gate-paused`); at most 8 waiting knocks; tables unhosted for 14 days are deleted.
- `TRUST_PROXY=none|xff|cf`, default `none`. Player sockets and `POST /api/tables` require `Origin` = the configured public origin; the GM socket is not origin-checked.
- The relay never parses, stores or logs game bodies, and never logs `Authorization`, secrets, host keys or query strings.
- UI text through `t()`; English stays byte-identical; every new key has a Simplified Chinese translation per `docs/fork/zh-glossary.md`.
- Upstream conventions (`docs/fork/FORK_GUIDE.md`): explicit return types, no `any`, no inline eslint-disable / ts-ignore, files under ~300 lines; `npx tsc --noEmit`, `npm run lint`, `npx vitest run --project unit`, `npm run build` stay green after every task.

## Review Focus

1. Switching the server address while a table is saved for the old server: the saved table must not be replayed to the new server (Task 3 test `drops a saved table of another server`).
2. A wrong host key: the relay answers 401, which upstream's client treats as "signed out" and clears the token; on a self-hosted server the host key must survive and the GM sees "主持密钥不正确" (Task 3 test `keeps the host key on 401`).
3. Server address typed with a trailing slash, a path, upper case or `ws://`: normalised or rejected, never half-accepted (Task 2 tests of `normalizeServerOrigin`).
4. Relay restart while a table runs: the GM reconnects with its saved code and secret and is welcomed again (Task 6 test `welcomes a GM after a restart`).
5. Public origin behind a proxy (`https://play.example.com` vs `:443` or a trailing slash): player sockets from the real page must pass the Origin check, others must not (Task 7 test `checks Origin exactly`).

---

### Task 1: M0 fork policy and workspace for `apps/`

**Files:**
- Modify: `docs/fork/FORK_GUIDE.md` (fork rules, branches)
- Modify: `package.json` (workspaces, scripts), `eslint.config.mjs:100` (global ignores)
- Create: `apps/relay/package.json`, `apps/relay/tsconfig.json`, `apps/relay/src/main.ts` (placeholder entry that exits 0), `apps/relay/README.md`

**Interfaces:**
- Produces: npm workspace `apps/relay` (package name `@atlas-fork/relay`, `"type": "module"`, `"engines": {"node": ">=22.18"}`, dependency `"ws": "8.18.3"`, devDependency `"@types/ws": "8.18.1"`); root scripts `"relay": "node apps/relay/src/main.ts"` and `"check:relay": "tsc -p apps/relay"`.

- [ ] **Step 1: Update FORK_GUIDE.** Replace the rule "Never touch Atlas Online code, auth, or network endpoints" with: `src/app/online/`, `apps/` and the online protocol are fork-owned (no upstream merges there; conflicts resolve to the fork), per spec 6.6; add `apps/relay` to the commands section.
- [ ] **Step 2: Workspace.** Root `package.json` gains `"workspaces": ["apps/*"]` and the two scripts; `apps/relay/tsconfig.json` extends nothing, sets `"module": "nodenext"`, `"target": "es2023"`, `"strict": true`, `"noEmit": true`, `"allowImportingTsExtensions": true`, `"types": ["node"]`, includes `src/**/*.ts` and `../../src/app/online/protocol/**/*.ts`. ESLint: add `"apps/"` to `globalIgnores` (the relay is checked by `check:relay`; Obsidian rules do not apply to it).
- [ ] **Step 3: Verify.** Run `npm install && npm run check:relay && npm run relay && npm run lint && npx tsc --noEmit`. Expected: all exit 0; `npm run relay` exits 0 with no output.
- [ ] **Step 4: Commit** `git commit -m "M0: fork-owned online code and an apps/relay workspace"`.

### Task 2: Configurable server origins

**Files:**
- Modify: `src/app/online/gm/servers.ts`; importers `src/app/online/gm/tableStart.ts:8,58,60`, `OnlineControl.ts:16,293`, `account/AccountControl.ts:2,70,87,111,121,127`, `companionDiagnostics.ts:7,56,90,100`, `gmLevel.ts:3,19,25`
- Test: `tests/unit/online/gm/servers.test.ts` (new); update `createdTable.test.ts`, `accountSignIn.test.ts`, `survivesReloads.test.ts`, `onlineSettings.test.ts`, `gmLevel.test.ts` to call `setServerOrigin(UPSTREAM_RELAY_ORIGIN)` in `beforeEach`.

**Interfaces:**
- Produces (in `servers.ts`):
  - `export const UPSTREAM_RELAY_ORIGIN = 'https://play.atlas-vtt.dev'`, `UPSTREAM_ACCOUNTS_ORIGIN = 'https://api.atlas-vtt.dev'`, `UPSTREAM_ACCOUNT_PAGE_URL = 'https://atlas-vtt.dev/account'`
  - `normalizeServerOrigin(value: string): string | null` — accepts `http(s)://host[:port]` with an optional trailing `/`; lowercases scheme and host; drops a default port; rejects paths, queries, fragments, credentials and any other scheme.
  - `setServerOrigin(origin: string | null): void`, `relayOrigin(): string | null`, `isSelfHosted(): boolean`, `accountsOrigin(): string`, `accountPageUrl(): string`.

- [ ] **Step 1: Write the failing tests** in `servers.test.ts`: `normalizeServerOrigin('https://Play.Example.com/')` → `'https://play.example.com'`; `'https://play.example.com:443'` → `'https://play.example.com'`; `'http://192.168.1.5:8080'` kept; `'https://x.com/path'`, `'ws://x.com'`, `'https://u:p@x.com'`, `''` → `null`; after `setServerOrigin(null)` `relayOrigin()` is `null` and `isSelfHosted()` false; after `setServerOrigin('https://play.example.com')` `isSelfHosted()` true; after `setServerOrigin(UPSTREAM_RELAY_ORIGIN)` false.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/gm/servers.test.ts`. Expected: FAIL (exports missing).
- [ ] **Step 3: Implement** the module state in `servers.ts` and replace every use of the three constants with the accessors. `startBlock` (`tableStart.ts:31-35`) first returns `'Set the online server address in Atlas settings first.'` when `relayOrigin()` is `null`. `gmLevel.ts` keys its cache by `relayOrigin()`.
- [ ] **Step 4: Run** the new test and the updated online tests: `npx vitest run --project unit tests/unit/online`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Online: configurable server origin, empty by default"`.

### Task 3: Server setting and host key

**Files:**
- Modify: `src/app/online/gm/settings.ts` (`OnlineSettings`, `readSettings`, `onlineSettingsSections`), `account/tokenStore.ts`, `account/AccountControl.ts`, `account/accountView.ts`, `createdTable.ts` / `tableStart.ts:65` (401 handling), `OnlineFeature.ts:132` (apply the origin on load and on change), `companionDiagnostics.ts` (no post when self-hosted), the dock account menu
- Test: `tests/unit/online/gm/selfHostedAccount.test.ts` (new), `onlineSettings.test.ts`, `noKeys.test.ts`

**Interfaces:**
- Consumes: Task 2 accessors.
- Produces: `OnlineSettings.serverOrigin: string` (default `''`, read through `normalizeServerOrigin`, invalid → `''`); `HOST_KEY_SECRET_ID = 'atlas-host-key'` and `secretHostKeyStore(app: App): TokenStore` in `tokenStore.ts`; `AccountPorts.hostKeys: TokenStore`; `AccountControl.token()` returns `hostKeys.get()` when `isSelfHosted()`.

- [ ] **Step 1: Write the failing tests** (`selfHostedAccount.test.ts`, fake ports as in `accountSignIn.test.ts`): `token()` returns the host key when self-hosted and the account token otherwise; `refresh()` makes no request when self-hosted; `signIn()` does nothing when self-hosted; `keeps the host key on 401` (a 401 from `POST /api/tables` leaves `hostKeys.get()` unchanged and yields the text `'The host key is not accepted by this server.'`); `drops a saved table of another server` (a saved table whose origin differs from `relayOrigin()` is not replayed by `OnlineControl`, pattern of `survivesReloads.test.ts`); `readSettings({ serverOrigin: 'https://A.com/' }).serverOrigin === 'https://a.com'`, `readSettings({ serverOrigin: 'nope' }).serverOrigin === ''`. In `noKeys.test.ts` add: `naming(/hostKeys\.get\(/)` equals `['gm/account/AccountControl.ts']`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The saved table records the origin it was made on (`savedTable.ts` gains `origin: string`; a record without one counts as upstream's). Settings rows: "Online server address" (text, saved normalised, invalid input shows `'Enter an address such as https://play.example.com.'`), "Host key" (password input, only when self-hosted, stored through `secretHostKeyStore`). The dock's account menu shows `'Host key set'` / `'No host key yet'` instead of sign-in when self-hosted.
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/online && npx tsc --noEmit && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Online: host key replaces the account on a self-hosted server"`.

### Task 4: Online UI in Chinese

**Files:**
- Modify: every file under `src/app/online/gm/` and `src/app/online/tableLog/` (and `marks/` if it shows text) that holds user-facing English; `src/app/plugin/onlinePlay.ts`
- Create: `src/app/i18n/locales/en/onlineGm.ts`, `en/onlineLog.ts`, the matching `zh/` files, registered in both `index.ts`
- Create: `docs/fork/online-strings.md` (the inventory)

**Interfaces:**
- Consumes: Task 3 texts (they move into `onlineGm`).
- Produces: modules `onlineGm` and `onlineLog` (split further by sub-area if one passes ~250 keys).

- [ ] **Step 1: Inventory.** List every user-facing string in the scope, with file:line, into `docs/fork/online-strings.md`. Keep English, and say so in the inventory, exactly the kinds `docs/fork/i18n-zh-gap.md` ("Deliberately left English") lists, plus anything sent over the wire to players (protocol strings, log entry kinds) and text stored in the vault.
- [ ] **Step 2: Wire and translate.** Each string becomes a key in `onlineGm` / `onlineLog`; zh per the glossary. `tableLog/` is shared code: it imports `t` from `src/app/i18n` (allowed: `i18n` is in the shared boundary).
- [ ] **Step 3: Verify.** `npx tsc --noEmit && npm run check:boundaries && npm run lint && npx vitest run --project unit` and the zh coverage check (every en key present in zh with identical placeholders; script as in `docs/fork/i18n-zh-gap.md` "Result"). Expected: all PASS; English output unchanged (existing online tests assert English).
- [ ] **Step 4: Commit** `git commit -m "Online: route GM and table-log text through t(), with Chinese"`.

### Task 5: Relay HTTP and table registry

**Files:**
- Create: `apps/relay/src/config.ts`, `tables.ts`, `persist.ts`, `http.ts`, `limits.ts`, `server.ts`; update `main.ts`
- Test: `tests/unit/relay/http.test.ts`, `tests/unit/relay/relayHarness.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): RelayConfig` with `RelayConfig = { hostKey: string; host: string; port: number; publicOrigin: string; maxPlayers: number; statePath: string; staticDir: string | null; trustProxy: 'none' | 'xff' | 'cf'; timing: RelayTiming }` and `RelayTiming = { knockWaitMs: number; wrongCodeWindowMs: number; wrongCodePauseMs: number; unhostedTableMs: number }` (defaults 180000, 600000, 600000, 1209600000). Env names: `HOST_KEY` (required, ≥ 24 chars), `HOST` (default `127.0.0.1`), `PORT` (8787), `PUBLIC_ORIGIN` (required, normalised like Task 2), `MAX_PLAYERS` (8, 1-12), `STATE_PATH` (`./relay-state.json`), `STATIC_DIR`, `TRUST_PROXY`.
  - `startRelay(config: RelayConfig): Promise<RunningRelay>` with `RunningRelay = { origin: string; close(): Promise<void> }` (port 0 allowed for tests).
  - `TableRegistry` in `tables.ts`: `create(code: string): { code: string; secret: string; maxPlayers: number } | 'full'`, `checkSecret(code: string, secret: string): boolean`, `end(code: string): void`.
  - `relayHarness.ts`: `startTestRelay(overrides?: Partial<RelayConfig>): Promise<RunningRelay & { config: RelayConfig }>` (temp state file, port 0, short timings).
- [ ] **Step 1: Write the failing tests** (`http.test.ts`, real `fetch` against `startTestRelay()`): `POST /api/tables` with the right Bearer and `{code: 'a'.repeat(26), gmLevel: 7}` and the public Origin → 201 `{code, secret, maxPlayers: 8}` with `code` echoed and `secret` matching `/^[A-Za-z0-9_-]{43}$/`; wrong Bearer → 401; 5 wrong Bearers then the right one → 429 (locked); 11 tables → 429 on the 11th; a code not matching `/^[a-z2-7]{26}$/` → 400; a foreign `Origin` → 403; re-POST of the same code returns a new secret; `GET /api/me` → 200 with `access.maxPlayers`; `POST /api/feedback` → 204; the state file after a create holds no plain secret (only a hash); a restarted relay on the same state file still accepts the old secret via `checkSecret`; the 11th `POST /api/tables` within a minute → 429; with `unhostedTableMs: 50` a table nobody hosted is gone after 100 ms (`checkSecret` false).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay/http.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Secrets: `crypto.randomBytes(32).toString('base64url')`, stored as SHA-256 hex, compared with `timingSafeEqual`. Persistence: write `statePath + '.tmp'` then `rename`. Static files from `staticDir` with `Content-Security-Policy: default-src 'self'; script-src 'self'` and `X-Content-Type-Options: nosniff`. No request logging beyond method, path without query, and status.
- [ ] **Step 4: Run** the test, then `npm run check:relay`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: HTTP table creation, host key, persistence"`.

### Task 6: Relay GM socket

**Files:**
- Create: `apps/relay/src/socket.ts` (upgrade, size and hello handling), `gmLink.ts`
- Test: `tests/unit/relay/gmSocket.test.ts`

**Interfaces:**
- Consumes: `TableRegistry`, shared `parseClientFrame` / `isOtherVersion` / `CLOSE` / `MAX_GM_FRAME` from `src/app/online/protocol/relay.ts`.
- Produces: the socket path `/api/tables/{code}/socket` on the `startRelay` server; per-table state `{ gm: WebSocket | null; gate: { code: string | null; ask: boolean }; roster: CampaignSeat[] }`.
- [ ] **Step 1: Write the failing tests** (a `ws` client as GM): hello with the right secret → `welcome` with `role: 'gm'`, `players: []`, `batch: true` within 8 s; wrong secret → close 4001; another protocol version → 4007; text `ping` → text `pong`; a 5 KiB first frame → 4004; a 300 KiB `send` after welcome is accepted; a second GM hello closes the first with 4002; `end` closes with 4008 and a later POST of the code makes a fresh table; `welcomes a GM after a restart` (close the relay, start it on the same state file, reconnect with the saved secret → `welcome`).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay/gmSocket.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `ws`'s `WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })`, enforcing 4 KiB before an accepted GM hello in the message handler.
- [ ] **Step 4: Run** it and `npm run check:relay`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: GM socket, handshake and limits"`.

### Task 7: Relay players, routing and join gate

**Files:**
- Create: `apps/relay/src/playerLink.ts`, `joinGate.ts`, `routing.ts`
- Test: `tests/unit/relay/players.test.ts`, `tests/unit/relay/joinGate.test.ts`

**Interfaces:**
- Consumes: Task 6 table state; shared `parseRelayFrame`, `PLAYER_ID_PATTERN`, `playerName`, `MAX_WAITING`, `MAX_PLAYERS`.
- Produces: `JoinGate` (pure, in `joinGate.ts`): `decide(hello: PlayerHello, table: GateView, now: number): GateDecision` with `GateDecision = { kind: 'welcome'; id: string; key: string } | { kind: 'knock'; id: string } | { kind: 'close'; code: number } | { kind: 'pause'; until: number }`.
- [ ] **Step 1: Write the failing tests.** `joinGate.test.ts` (pure, injected `now`): a known key → welcome with its id; a roster seat code → welcome with that seat's id; a newcomer with the right join code and `ask: false` → welcome with a new 20-char id; `ask: true` → knock; wrong code → close 4010, the 5th wrong code within 10 minutes → pause (4011, `until = now + 600000`); 9th waiting knock → 4014; full table → 4003. `players.test.ts` (real sockets): admit → player gets `welcome {id, key, gmOnline: true}` and GM gets `player-joined`; decline → 4012; no answer within `knockWaitMs` → 4013; player `send {body}` reaches the GM as `game {from: id, body}`; GM `send {to: id}` and `sends` reach only that player, `to: '*'` all; `kick` → 4009 and the key no longer works; GM disconnect → players get `gm {online: false}`; 21 frames in one second from a player → 4005; the 21st socket from one address → refused; with `trustProxy: 'xff'` the limit counts the `X-Forwarded-For` address, with `'none'` it ignores that header; `checks Origin exactly` (the configured public origin passes, a different port or scheme is refused, the GM socket without Origin passes).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Bodies are forwarded as received (`JSON.stringify` of the frame with `from` added), never inspected beyond `parseClientFrame`'s envelope.
- [ ] **Step 4: Run** the relay tests and `npm run check:relay`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: players, routing and the join gate"`.

### Task 8: Conformance with the real GM client

**Files:**
- Test: `tests/unit/relay/gmClientConformance.test.ts`, `tests/unit/relay/headlessPlayer.ts`

**Interfaces:**
- Consumes: `startTestRelay`; the GM's `TableConnection` (`src/app/online/gm/TableConnection.ts`, constructed as in `tests/unit/online/gm/tableConnection.test.ts`); `ws`'s `WebSocket` installed as `globalThis.WebSocket` for the test.
- Produces: `headlessPlayer(origin: string, code: string, hello: { name: string; code?: string; key?: string }): Promise<HeadlessPlayer>` with `HeadlessPlayer = { welcome: Promise<{ id: string; key: string }>; messages: GmMessage[]; send(body: PlayerMessage): void; closed: Promise<number> }`, parsing frames with the shared `parseRelayFrame` and `parseGmMessage` and reassembling nothing (Plan 2 adds `part`).
- [ ] **Step 1: Write the failing test:** the real `TableConnection` against the relay reaches its open state; with `gate {code: '123456', ask: true}` a headless player with that code knocks, the GM client's knock handler admits it, the player is welcomed, a GM `send` reaches the player as a parsed `GmMessage`, a player `roll` body reaches the GM client as `game` from the player's id; the GM client's own `ping` gets the relay's `pong` (observe it on the socket rather than waiting 30 s).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay/gmClientConformance.test.ts`. Expected: PASS once Tasks 5-7 are correct; a FAIL here is a relay bug, fixed in the relay, never by changing the GM client.
- [ ] **Step 3: Commit** `git commit -m "Relay: conformance test against the GM's TableConnection"`.

### Task 9: End to end through OnlineControl

**Files:**
- Test: `tests/unit/relay/endToEnd.test.ts`
- Modify: `apps/relay/README.md` (how to run: env vars, `npm run relay`), `docs/fork/FORK_GUIDE.md` (relay commands)

**Interfaces:**
- Consumes: Task 3 settings and host key; Task 8 `headlessPlayer`; the `OnlineControl` setup of `tests/unit/online/gm/survivesReloads.test.ts` (copy its mocks; its `requestUrl` mock forwards to `fetch` against the test relay).
- [ ] **Step 1: Write the test:** with `serverOrigin` = the relay's origin and the host key set, `OnlineControl` starts a table for a campaign (real `POST /api/tables` with the Bearer host key), connects, and shows a join link `${origin}/#${code}`; a headless player joins with the join code and is admitted; the player receives the scene message the GM sends on `player-joined`; the GM stops the table and the player's socket closes with 4008.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay/endToEnd.test.ts`. Expected: PASS.
- [ ] **Step 3: Full verification:** `npx tsc --noEmit && npm run check:relay && npm run check:boundaries && npm run lint && npx vitest run --project unit && npm run build`. Expected: all exit 0.
- [ ] **Step 4: Commit** `git commit -m "Online: end-to-end test, GM to self-hosted relay to player"`.
