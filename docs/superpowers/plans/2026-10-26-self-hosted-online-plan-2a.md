# Self-hosted online play, Plan 2a (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player opens the table link on a phone or desktop browser, joins with a name and code, and sees the presented scene without lighting (map, grid, tokens, fog, pins, drawings), reads and writes the table log, rolls dice in the four modes, sees the initiative order and the players, and gets a "your turn" alert.

**Architecture:** A new Vite + React + PixiJS v8 app in `apps/play/`, served by the relay at `/`. It imports only the `shared` boundary set (protocol parsers, `DeltaReader`, `tableLog/` React UI, grid drawers, fog compositor, i18n) plus allowed npm packages; transport, storage and drawing glue are its own. The GM side gains two fork protocol messages (`client`, `your-turn`). Lighting, own-token dragging, the server image cache and pause are Plan 2b (M4).

**Tech Stack:** TypeScript, React 19.3.1, PixiJS 8.22.0, pixi-viewport 6, Vite 6.4.3, zustand 5, vitest 4 (jsdom for UI tests), Node >= 22.18 for the relay.

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (sections 2 G2, G3a, G5, G7, G9; 5; 6.3; 8). Contract: `docs/fork/online-contract.md` (sections 1.2, 2, 4, 5). Inventory of reusable shared code (file:line, signatures) used to write this plan: section "Reference" at the end.

## Global Constraints

- `apps/play` imports only files of the `shared` group in `scripts/boundaries.mjs`, files of its own `play` group, and the npm packages listed for `play`; `npm run check:boundaries` enforces it (Task 1). Relative imports only (no `src/` or `@/` aliases).
- Anti-goal: nothing the GM hides reaches a player. The app draws only what it is sent and never asks for more than the GM offers. A scene whose `scene.lit` is `true` shows the placeholder "此场景需要动态光照，下个版本支持 / This scene needs dynamic lighting (coming next)" and the app never requests its map image nor draws tokens, fog or layers of it (fail closed, G3a). `lighting`, `sight`, `explored`, `doors`, `sensed`, `live`, `marks`, `widgets`, `shown-image` and book messages are ignored in M3.
- Wire rules: every frame the app sends is `JSON.stringify({ v: 1, t: 'send', body })` (or the hello) and at most `MAX_PLAYER_FRAME` (4 KiB) — a larger one is not sent and is reported as a refusal; bare text `ping` every `KEEPALIVE_MS` (30 s) after welcome; reconnect backoff `min(30 s, 500 ms · 2^attempt) · (0.5..1.0)`; `FINAL_CLOSE_CODES` never reconnect.
- Assets: requested with `asset-request`, re-asked from the next missing chunk only after 10 s without progress, verified by SHA-256 before use, kept in IndexedDB by hash. Map images are requested with `maxSide = 4096` in low-power mode and `min(8192, renderer max texture size)` otherwise; token and initiative art with `maxSide = 512`. A variant is drawn at the `width` × `height` of the `asset-variant` message (the world size), never at its own pixel size.
- Fork protocol: `FORK_PROTOCOL_LEVEL = 1` in `src/app/online/protocol/fork.ts`; the app sends `{t:'client', app:'atlas-fork-play', forkLevel: 1}` right after every welcome. `your-turn` is sent only to players whose recorded level is >= 1.
- Language: Simplified Chinese by default, English selectable; the choice is stored with `saveLanguageChoice(localStorage, …)` under `atlas-vtt:language` (`src/app/i18n/languageChoice.ts`); `setLocale` runs before any module that calls `t()` at load. Every new key is in `locales/en/onlinePlay.ts` and `locales/zh/onlinePlay.ts`, Chinese per `docs/fork/zh-glossary.md`. Dice mode labels: 公开 / 仅主持人 / 暗骰 / 仅自己.
- Content-Security-Policy of the relay's static responses (exact): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. No inline scripts in the built `index.html` (`build.modulePreload.polyfill = false`). Pixi needs no eval at run time: the app imports `pixi.js/unsafe-eval` once (check the current PixiJS v8 docs for the CSP entry point before writing Pixi code, per upstream `CLAUDE.md`).
- AGPL-3.0 §13: a "源代码 / Source" link to `https://github.com/luoxin9510/atlas-vtt` and a "许可证 / Licence" link (AGPL-3.0) in the app's settings sheet and on the join screen.
- Phone-first: usable at 360 × 640 CSS px; panels are a bottom sheet below 768 px width and a side panel above. Gestures: one finger elsewhere and two fingers pan, pinch zooms (never rotates), tap selects a token, long press (500 ms, moved < 10 px) opens the token card; mouse: left drag pans, wheel zooms, right click = long press. One finger on an own token is recognised as `drag-token` but does nothing until Plan 2b.
- Low-power mode (player setting `atlas-play:low-power`, default on when `prefers-reduced-motion: reduce` matches or `navigator.hardwareConcurrency <= 4`): `app.ticker.maxFPS = 30`, renderer resolution 1 (else `min(devicePixelRatio, 2)`), no animations.
- Upstream conventions (`docs/fork/FORK_GUIDE.md`): explicit return types, no `any`, no inline eslint-disable / ts-ignore, files under ~300 lines, UI text through `t()`. After every task: `npx tsc --noEmit`, `npm run check:play`, `npm run check:boundaries`, `npm run lint`, `npx vitest run --project unit` stay green; from Task 1 on also `npm run build:play`.
- Player tests live in `tests/unit/play/` (jsdom tests start with `// @vitest-environment jsdom`), GM tests in `tests/unit/online/`.

## Review Focus

1. A lit scene arriving after an unlit one (or a `scene` message whose `lit` changes): the old map, tokens and fog are torn down and no request for the new map is made (Task 5 test `drops the unlit picture when the scene turns lit`, Task 7 test `never requests a lit scene's map`).
2. A saved key the relay no longer knows (table re-created, player kicked): the app must not loop reconnecting; it forgets the key and shows the join form with the reason (Task 3 test `forgets a refused key`).
3. A `part`-split message interleaved with other messages and with parts of another id, or a part set that never completes: the message is applied once, in the order its last part arrived, and incomplete sets are dropped after 30 s (Task 4 tests).
4. A phone that sleeps for minutes and wakes: the socket is dead without a close event; the app notices within 20 s of its next ping (no frame since), reconnects, and resyncs instead of showing stale tokens (Task 3 test `reconnects after a silent socket`, Task 4 test `resyncs on a gap after reconnect`).
5. A `gm`, `blind` or `self` roll by one player: no other player's log, `people` or `roll` stream shows it, and `your-turn` goes only to the owner and never on resyncs, reconnects or full-list resends (Task 2 tests).

---

### Task 1: `apps/play` workspace, boundary group, served shell

**Files:**
- Create: `apps/play/package.json`, `apps/play/tsconfig.json`, `apps/play/vite.config.mts`, `apps/play/index.html`, `apps/play/src/main.tsx`, `apps/play/src/i18nInit.ts`, `apps/play/src/theme.scss`, `apps/play/src/ui/AppShell.tsx`, `apps/play/src/ui/LegalLinks.tsx`, `apps/play/README.md`
- Create: `src/app/i18n/locales/en/onlinePlay.ts`, `src/app/i18n/locales/zh/onlinePlay.ts`; modify both `locales/<lang>/index.ts`
- Modify: `scripts/boundaries.mjs` (new `play` group), `scripts/boundaries/graph.mjs:51` (audit `apps/play/`), root `package.json` (scripts), `apps/relay/src/static.ts:23` (CSP), `tests/unit/relay/staticServing.test.ts:60`, `docs/fork/FORK_GUIDE.md` (commands), `.gitignore` (`apps/play/dist/`)
- Test: `tests/unit/play/boundaries.test.ts`, `tests/unit/play/i18nInit.test.ts`

**Interfaces:**
- Produces: workspace `@atlas-fork/play` (`"type": "module"`, private); root scripts `"dev:play": "vite --config apps/play/vite.config.mts"`, `"build:play": "vite build --config apps/play/vite.config.mts"`, `"check:play": "tsc -p apps/play"`; build output `apps/play/dist/` (what `STATIC_DIR` points at).
- Produces: `initLanguage(storage: ChoiceStorage | null, browserLanguage: string): string` in `i18nInit.ts` (calls `setLocale(languageOf(readLanguageChoice(storage), browserLanguage), TRANSLATIONS)`, returns the locale); `main.tsx` imports `./i18nInit.ts` first, which runs it with `localStorage` (guarded by try/catch) and `navigator.language`, then dynamically imports the app.
- Produces: `onlinePlay.*` keys (one file per language, starting with `onlinePlay.app.title`, `onlinePlay.legal.source`, `onlinePlay.legal.licence`, `onlinePlay.lit.placeholder`); later tasks add their keys to the same files.
- Produces: `play` boundary group: include `apps/play/src/**/*.ts`, `apps/play/src/**/*.tsx`; exclude tests; `mayImport: ['shared', 'play']`; packages = the shared list (`clipper2-ts, pixi.js, pixi-viewport, pixi-filters, react, react-dom, framer-motion, three, lucide-react, @radix-ui/*, clsx, tailwind-merge, zustand, immer`). `ASSET_ROOTS` gains `apps/play/src/` for SCSS.

- [ ] **Step 1: Write the failing tests.** `boundaries.test.ts`: run `checkBoundaries(root, manifest)` (`scripts/boundaries/graph.mjs`) on a temporary copy containing `apps/play/src/bad.ts` with `import '../../../src/app/online/gm/OnlineTable.ts'` → one violation naming `apps/play/src/bad.ts`; with `import { t } from '../../../src/app/i18n/index.ts'` → none; with `import 'howler'` → one. `i18nInit.test.ts`: `initLanguage(null, 'en-US')` returns `'zh'`; with a storage holding `'en'` returns `'en'`; with `'obsidian'` and browser `'en-GB'` returns `'en'`; after it, `t('onlinePlay.app.title')` is the Chinese title. `staticServing.test.ts`: the CSP string above, exactly.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play tests/unit/relay/staticServing.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `apps/play/tsconfig.json`: `module: "esnext"`, `moduleResolution: "bundler"`, `target: "es2022"`, `jsx: "react-jsx"`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `allowImportingTsExtensions`, `noEmit`, `lib: ["DOM", "DOM.Iterable", "ESNext"]`, `types: []`, `paths: { "obsidian": ["../../scripts/boundaries/no-obsidian.d.ts"] }`; include `src/**/*`, `../../src/assets.d.ts` and the shared include globs. `vite.config.mts`: `root: 'apps/play'`, `base: '/'`, `plugins: [react()]`, the root's scss `preprocessorOptions`, `resolve.dedupe: ['pixi.js', 'react', 'react-dom']`, `server.fs.allow: ['../..']`, `server.proxy` of `/api` (with `ws: true`) to `PLAY_RELAY` (default `http://127.0.0.1:8787`), `build.outDir: 'dist'`, `emptyOutDir`, `target: 'es2022'`, `modulePreload: { polyfill: false }`, `sourcemap: false`. `main.tsx` installs the DOM host (`installDomHost`, same shape as `tests/setup/domHost.ts`) and mounts `AppShell`, which shows the title and `LegalLinks` for now. `theme.scss` defines on `:root` (light and `prefers-color-scheme: dark`) every Obsidian variable the inventory lists for `tableLog/` and primitives (`--text-normal`, `--text-muted`, `--text-faint`, `--text-error`, `--text-accent`, `--text-on-accent`, `--interactive-accent`, `--interactive-accent-hover`, `--background-primary`, `--background-secondary`, `--background-modifier-hover`, `--background-modifier-active-hover`, `--background-modifier-border`, `--background-modifier-form-field`, `--color-red|orange|yellow|green|cyan|blue|purple|pink`, `--mono-100`, `--font-interface`, `--font-monospace`, `--font-ui-small|smaller|medium`, `--font-semibold`, `--line-height-tight`, `--input-height`, `--radius-s|m|l|xl`, `--shadow-s|l`) and imports `styles/_tokens.scss`-based `tableLog` and `marks` styles. Relay CSP per Global Constraints. `graph.mjs:51` also audits files starting with `apps/play/`.
- [ ] **Step 4: Verify.** `npm install && npx vitest run --project unit tests/unit/play tests/unit/relay && npm run check:play && npm run check:boundaries && npm run build:play && npx tsc --noEmit && npm run lint`. Expected: PASS; `apps/play/dist/index.html` contains no `<script>` without `src` (`grep -c '<script>' apps/play/dist/index.html` → 0).
- [ ] **Step 5: Commit** `git commit -m "Play: apps/play workspace, boundary group and served shell"`.

### Task 2: Fork protocol `client` and `your-turn`, GM side

**Files:**
- Create: `src/app/online/protocol/fork.ts`, `src/app/online/gm/forkClients.ts`, `src/app/online/gm/YourTurnShare.ts`
- Modify: `src/app/online/protocol/game.ts` (`PlayerMessage`, `parsePlayerMessage`, `GmMessage`, `parseGmMessage`), `src/app/online/protocol/index.ts`, `src/app/online/gm/OnlineTable.ts:192` (route `client`, forget on `player-left`), `src/app/online/gm/SceneShare.ts` / `TokenShare.ts:248` (feed turn changes)
- Test: `tests/unit/online/protocol/fork.test.ts`, `tests/unit/online/gm/yourTurn.test.ts`, `tests/unit/online/gm/rollPrivacy.test.ts`

**Interfaces:**
- Produces (`protocol/fork.ts`): `export const FORK_PROTOCOL_LEVEL = 1`; `export const FORK_APP = 'atlas-fork-play'`; `export interface PlayerClient { readonly t: 'client'; readonly app: string; readonly forkLevel: number }` (`app` <= 64 chars, `forkLevel` integer 0..1000); `export interface YourTurnMessage { readonly t: 'your-turn'; readonly scene: string }`; `parsePlayerClient(value: Record<string, unknown>): PlayerClient | null`; `parseYourTurn(value: Record<string, unknown>): YourTurnMessage | null`. `PlayerClient` joins `PlayerMessage`, `YourTurnMessage` joins `GmMessage`; both parsers gain one branch each.
- Produces (`gm/forkClients.ts`): `class ForkClients { record(player: string, message: PlayerClient): void; levelOf(player: string): number /* 0 when none */; forget(player: string): void }`.
- Produces (`gm/YourTurnShare.ts`): `class YourTurnShare { constructor(ports: { ownerOf(tokenId: string): string | null; levelOf(player: string): number; send(body: GmMessage, to: string): void }); update(scene: string, turnTokens: ReadonlySet<string>): void; reset(): void }`. `update` sends `{t:'your-turn', scene}` to the owner of every token id that is in `turnTokens` and was not in the previous call's set for the same scene, when that owner's level is >= `FORK_PROTOCOL_LEVEL`; a different scene id replaces the previous set without sending; `reset()` (table restart) forgets the set.
- Consumes: `sharedTurnTokens(...)` from `gm/turnShare.ts` (the same set `TokenShare` uses for `SharedToken.turn`), `Ownership.ownerOf`.

- [ ] **Step 1: Write the failing tests.** `fork.test.ts`: `parsePlayerMessage({t:'client', app:'atlas-fork-play', forkLevel:1})` returns the message; `forkLevel: 1.5`, `-1`, a 65-char `app` → null; `parseGmMessage({t:'your-turn', scene:'s1'})` returns it; missing scene → null. `yourTurn.test.ts` (fake ports): turn moves to token `a` owned by `p1` (level 1) → one `your-turn` to `p1`; the same set again (a resync or resend) → nothing; turn to `b` owned by `p2` with level 0 → nothing; `p1` reconnects (the GM re-sends everything) → nothing; turn back to `a` after `b` → one more to `p1`; scene change with `a` already holding the turn → nothing. Through the real `SceneShare` (`shareHarness` with `FakeSeats`): advancing initiative so `p1`'s token gets the turn produces exactly one `{body:{t:'your-turn'}, to:'p1'}` in `harness.sent` and none to `p2`. `rollPrivacy.test.ts` (existing GM roll path, `PlayerRolls` / `gmRolls`): a `gm`, `blind` and `self` roll by `p1` produces no message to `p2` whose log entry, `people` or `roll` names that roll; a `public` roll does.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/protocol/fork.test.ts tests/unit/online/gm/yourTurn.test.ts tests/unit/online/gm/rollPrivacy.test.ts`. Expected: the fork and your-turn tests FAIL; `rollPrivacy` may pass already (it pins existing behaviour; if it fails, stop and report: that is a leak).
- [ ] **Step 3: Implement.** `OnlineTable` handles `client` before the other receivers (it answers nothing), keeps one `ForkClients`, forgets a player on `player-left`. `YourTurnShare` is fed where `TokenShare` computes the turn set. Do not raise `GM_LEVEL` (upstream's counter).
- [ ] **Step 4: Run** `npx vitest run --project unit tests/unit/online`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Online: fork protocol client and your-turn messages"`.

### Task 3: Table socket and seat storage

**Files:**
- Create: `apps/play/src/net/TableSocket.ts`, `apps/play/src/net/backoff.ts`, `apps/play/src/net/seatStore.ts`, `apps/play/src/net/closeReasons.ts`
- Test: `tests/unit/play/tableSocket.test.ts`, `tests/unit/play/seatStore.test.ts`

**Interfaces:**
- Produces:
  - `type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState' | 'bufferedAmount'> & { onopen: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null; onclose: ((event: { code: number }) => void) | null; onerror: (() => void) | null }`
  - `type JoinAs = { readonly name: string; readonly key?: string; readonly code?: string }`
  - `type SocketStatus = { kind: 'connecting' } | { kind: 'waiting' } | { kind: 'joined'; id: string; gmOnline: boolean } | { kind: 'retrying'; inMs: number } | { kind: 'refused'; code: number }`
  - `class TableSocket { constructor(options: { url: string; join: JoinAs; open: (url: string) => SocketLike; now?: () => number; random?: () => number; onStatus(status: SocketStatus): void; onGame(body: unknown): void; onSeat(seat: { id: string; key: string }): void; onPeople?(change: { joined?: PlayerInfo; left?: string }): void }); start(): void; send(body: unknown): boolean /* false when not joined or over MAX_PLAYER_FRAME */; stop(): void }`
  - `socketUrl(origin: string, code: string): string` (`https:` → `wss:`, `/api/tables/{code}/socket`).
  - `backoffMs(attempt: number, random: () => number): number`.
  - `seatStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null)` → `{ read(code: string): { id: string; key: string; name: string } | null; write(code: string, seat: {…}): void; forget(code: string): void; ownCode(code: string): string | null; writeOwnCode(code: string, own: string): void }` under keys `atlas-play:seat:<code>` / `atlas-play:own-code:<code>`; unreadable JSON reads as null.
  - `closeReasonKey(code: number): MessageKey` — one `onlinePlay.close.*` key per final close code (4001-4017) and `onlinePlay.close.other`.
- Behaviour fixed here: hello `{v:1,t:'hello',role:'player',name,key?,code?,waits:true,wait?}` (`newcomer: true` when neither key nor code); a `waiting{wait}` token is kept in memory and sent as `wait` on the next try; after `welcome` sends `{t:'client', app: FORK_APP, forkLevel: FORK_PROTOCOL_LEVEL}` before anything else and starts `ping` every 30 s; dead when no frame (any, `pong` included) arrived within 20 s of a ping → `close()` and retry; `gm{online}` updates `gmOnline`; final codes → `refused` and stop.

- [ ] **Step 1: Write the failing tests** (fake `SocketLike`, `vi.useFakeTimers()`): hello shapes for key / code / newcomer; `welcome` → `onSeat`, `joined`, then the first sent frame is the `client` message; `ping` sent every 30 s; `reconnects after a silent socket` (ping sent, 20 s no frame → closed, `retrying`, a new socket after the backoff); backoff values for attempts 0..6 with `random = () => 0` and `() => 0.999…` (500, 1000, …, capped 30 000, halved at most); close 4010 → `refused` with 4010 and no new socket; close 1006 → retry; `forgets a refused key` (a hello with `key` closed 4010 calls `seatStore.forget` through the app-level handler `onRefusedKey` — test the pure decision `refusedKey(code: number, hadKey: boolean): boolean` true for 4010 / 4009 / 4008 when a key was sent); `send` of a 5 KiB body returns false and sends nothing. `seatStore`: round trip, bad JSON → null, `forget`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/tableSocket.test.ts tests/unit/play/seatStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules; `onlinePlay.close.*` texts in en and zh (e.g. 4010 "加入码不正确 / The join code is wrong", 4012 "主持人拒绝了你的加入请求 / The GM declined", 4008 "这桌游戏已结束 / This table has ended").
- [ ] **Step 4: Run** the two tests, `npm run check:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: table socket with hello, keep-alive, backoff and seat storage"`.

### Task 4: Message feed: parts, deltas, resync

**Files:**
- Create: `apps/play/src/net/PartAssembler.ts`, `apps/play/src/net/GameFeed.ts`
- Test: `tests/unit/play/partAssembler.test.ts`, `tests/unit/play/gameFeed.test.ts`, `tests/unit/play/fixtures/sceneCorpus.ts`

**Interfaces:**
- Produces:
  - `class PartAssembler { constructor(now: () => number); take(part: { id: string; index: number; count: number; data: string }): unknown | null /* the parsed JSON once complete */; }` — pieces by `id`, base64 → bytes, concatenated in `index` order, UTF-8 decoded, `JSON.parse`d; a set whose first piece is older than 30 s is dropped on the next `take`; a second set with the same id but a different `count` replaces the first; at most 8 sets in flight (the oldest dropped).
  - `class GameFeed { constructor(ports: { send(body: PlayerMessage): void; apply(message: GmMessage): void; yourCode(message: YourCodeMessage): void; now(): number }); receive(body: unknown): void; reset(): void /* after a reconnect: new DeltaReader */ }` — `parseYourCode` first, then `parseGmMessage`; a `part` goes through the assembler and the result through `receive` again (never a part inside a part); `tokens`, `fog`, `sight`, `delta` go through `DeltaReader.read`: a message → `apply`, `null` → nothing, `'gap'` → `send({t:'resync', scene, of})` at most once per `of` per second.
- Consumes: `parseGmMessage`, `parseYourCode`, `DeltaReader`, `MAX_PARTS`.

- [ ] **Step 1: Write the failing tests.** `partAssembler`: a 500 KiB JSON body split with the GM's own `messageParts` (`src/app/online/gm/assetServe.ts`, test-only import) and fed in reverse order returns the body once; interleaved with parts of another id both complete; an incomplete set is dropped after 30 s; a count mismatch replaces. `sceneCorpus.ts`: builds a player's stream with `shareHarness` + `FakeSeats` (a scene with a map, three tokens of which one is `p1`'s, fog with a brush and an erasing rectangle, a grid, two pins, a drawing, a text, initiative of three) and returns `{ body, to }[]` filtered for `p1`. `gameFeed`: the corpus fed through `GameFeed` yields `apply` calls whose final `tokens` equals `tokenLists(sent).at(-1)` from the harness; `resyncs on a gap after reconnect` (after `reset()`, a `delta` arrives first → exactly one `resync` per `of`, a second gap within 1 s → none); `your-code` reaches `yourCode`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/partAssembler.test.ts tests/unit/play/gameFeed.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: message feed with part reassembly, deltas and resync"`.

### Task 5: Table state store

**Files:**
- Create: `apps/play/src/state/tableStore.ts`, `apps/play/src/state/sceneMode.ts`
- Test: `tests/unit/play/tableStore.test.ts`

**Interfaces:**
- Produces:
  - `type SceneMode = 'none' | 'lit-placeholder' | 'map'`; `sceneMode(scene: SharedScene | null): SceneMode` (`null` → `'none'`, `lit !== false` → `'lit-placeholder'`).
  - `interface TableState { status: SocketStatus; self: string | null; ownCode: string | null; scene: SharedScene | null; mode: SceneMode; tokens: readonly SharedToken[]; cell: number; fog: SharedFog | undefined /* undefined: not received yet → draw nothing of the map */; grid: SharedGrid | null; pins: readonly SharedPin[]; annotations: SharedAnnotations; initiative: SharedInitiative | null; rules: SharedRules | null; mine: ReadonlySet<string>; yourTurnAt: number | null; rollRefusal: RollRefusedMessage['reason'] | null; selected: string | null }`
  - `createTableStore(): StoreApi<TableState> & { applyMessage(message: GmMessage, now: number): void; setStatus(status: SocketStatus): void; setOwnCode(code: string): void; select(id: string | null): void; dismissYourTurn(): void }` (zustand `createStore`).
- Rules: messages whose `scene` differs from `state.scene?.id` are ignored; a `scene` message with another id clears tokens, fog (to `undefined`), grid, pins, annotations, initiative, mine and selection; while `mode === 'lit-placeholder'` every scene-layer message is ignored (nothing of the scene is kept); `your-turn` for the current scene sets `yourTurnAt = now`; `roll-refused` sets `rollRefusal`; ignored types per Global Constraints.

- [ ] **Step 1: Write the failing tests:** `sceneMode` for null / `lit:false` / `lit:true`; `drops the unlit picture when the scene turns lit` (unlit scene with tokens and fog, then `scene` with `lit:true` → tokens empty, fog undefined, mode `lit-placeholder`; a later `tokens` for it is ignored); a message of another scene id is ignored; `mine` sets the set; `your-turn` of another scene is ignored.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/tableStore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: table state store, lit scenes fail closed"`.

### Task 6: Asset downloader and cache

**Files:**
- Create: `apps/play/src/assets/AssetLoader.ts`, `apps/play/src/assets/blobCache.ts`, `apps/play/src/assets/sha256.ts`
- Modify: root `package.json` (devDependency `fake-indexeddb`, exact version)
- Test: `tests/unit/play/assetLoader.test.ts`, `tests/unit/play/blobCache.test.ts`

**Interfaces:**
- Produces:
  - `interface BlobCache { get(hash: string): Promise<Uint8Array | null>; put(hash: string, bytes: Uint8Array): Promise<void> }`; `indexedDbCache(factory: IDBFactory, name = 'atlas-play-assets'): BlobCache` (one object store `blobs`; any IndexedDB error reads as a miss and a failed write is ignored); `memoryCache(): BlobCache`.
  - `sha256Hex(bytes: Uint8Array): Promise<string>` (`crypto.subtle`).
  - `type LoadedAsset = { readonly bytes: Uint8Array; readonly mime: string; readonly width: number | null; readonly height: number | null /* world size from asset-variant */ }`
  - `class AssetLoader { constructor(ports: { send(body: PlayerMessage): void; cache: BlobCache; now(): number }); load(ref: AssetRef, maxSide: number | null): Promise<LoadedAsset | null> /* null: refused or failed verification */; receive(message: GmMessage): boolean /* true if it was an asset message */; tick(): void /* re-asks stalled downloads */; cancelAll(): void }`.
- Rules: a cached hash (original or the variant it was mapped to) resolves without a request; one `asset-request {hash, maxSide?}` per hash in flight; `asset-variant` maps the requested hash to the variant's `AssetRef` and size; chunks are collected by hash and index, `count` must match, total bytes must equal the ref's `size`; SHA-256 must equal the hash, else the download is dropped and re-requested once, then `null`; `asset-refused` → `null`; a download without a new chunk for 10 s is re-asked with `from` = first missing index, at most 3 times, then `null`; the cache key of a variant is its own hash, and the original's hash is remembered in memory only.

- [ ] **Step 1: Write the failing tests** with chunks produced by the GM's `assetServe.ts` helpers (test-only import) for a 1 MiB fake PNG: in-order and shuffled chunks resolve with verified bytes; a corrupted chunk → one re-request, then `null` after the second failure; `asset-refused` → `null`; stall → `from` re-ask after 10 s, at most 3; variant mapping returns `width`/`height` of the message; second `load` of the same hash hits the cache with no request. `blobCache` with `fake-indexeddb`: round trip, a factory that throws reads as a miss.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/assetLoader.test.ts tests/unit/play/blobCache.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: asset downloader with SHA-256 check and IndexedDB cache"`.

### Task 7: Scene view: map, grid, fog, camera and gestures

**Files:**
- Create: `apps/play/src/scene/SceneView.ts`, `apps/play/src/scene/mapSprite.ts`, `apps/play/src/scene/fogAdapter.ts`, `apps/play/src/scene/gestures.ts`, `apps/play/src/scene/lowPower.ts`, `apps/play/src/ui/SceneCanvas.tsx`, `apps/play/src/ui/LitPlaceholder.tsx`
- Test: `tests/unit/play/fogAdapter.test.ts`, `tests/unit/play/gestures.test.ts`, `tests/unit/play/sceneRequests.test.ts`, `tests/gpu/playScene.gpu.test.ts`

**Interfaces:**
- Consumes: `TableState` (Task 5), `AssetLoader` (Task 6), `GridSystem` (`src/app/grid/GridSystem.ts`), `FogCanvasCompositor` (`src/app/pixi/fog/FogCanvasCompositor.ts`), `MapImageView` type.
- Produces:
  - `sharedFogOperations(fog: SharedFog): Readonly<Record<string, FogOperation>>` — per operation `{id: op.id ?? 'op-<index>', kind:'fog', timestamp: index, isErasing: op.erase, type, points: pairs of the flat list, brushRadius: radius (0 for lasso/rectangle)}`; a rectangle becomes the `FogOperation` rectangle shape Atlas uses (check `types/fogTypes.ts` and `fogOperationShape.ts` for its fields). `null` fog means the whole map is covered.
  - `type Gesture = { kind: 'tap'; x: number; y: number } | { kind: 'long-press'; x: number; y: number } | { kind: 'pan' } | { kind: 'pinch' } | { kind: 'drag-token'; id: string }`; `class GestureRecognizer { constructor(options: { now(): number; tokenAt(x: number, y: number): string | null; isMine(id: string): boolean; onGesture(g: Gesture): void }); down(e: { id: number; x: number; y: number; button: number }): void; move(e: …): void; up(e: …): void; cancel(id: number): void; tick(): void }` — rules in Global Constraints (500 ms, 10 px; a second pointer turns any gesture into `pinch`; right button = `long-press` on down).
  - `lowPowerDefault(env: { reducedMotion: boolean; cores: number }): boolean`.
  - `class SceneView { constructor(canvasHost: HTMLElement, store: TableStoreApi, assets: AssetLoader, lowPower: boolean); destroy(): void }` — one Pixi `Application` (`preference: 'webgl'`), a `pixi-viewport` `Viewport` with `drag`, `pinch`, `wheel`, `decelerate` (off in low-power), clamped zoom 0.1..4; layers in order: map, grid, annotations, pins, tokens, fog (the fog above everything of the map; tokens under fog are covered). The map texture is made from `createImageBitmap(new Blob([bytes]))` and scaled to the world size; the camera fits the map on first load of a scene. `mapSprite.ts` implements `MapImageView` (`src/app/pixi/mapImage/mapImageView.ts`: `layer`, `worldRect`, `imageSize`, `overview(maxSide)`, `onChange`) over that sprite, so `GridSystem` draws `SharedGrid` (colour through `parseGridColor`, `src/app/grid/gridContrastColor.ts:42`; `numbers` as `cellNumbers`).

- [ ] **Step 1: Write the failing tests.** `fogAdapter`: brush with 3 points → 3 `{x,y}` points and `brushRadius`; erasing lasso keeps order; ids generated in order when missing; through `fogCoverage(...)` a point inside an un-erased brush `covers` and one inside its erasing rectangle does not. `gestures`: tap (down/up 100 ms, 3 px); long press (500 ms still → `long-press`, the later up is no tap); move 12 px → `pan`; two pointers → `pinch`; down on an own token and move → `drag-token`; down on another's token and move → `pan`; right button → `long-press`. `sceneRequests` (`never requests a lit scene's map`): a `SceneView` built with a fake loader over a store that receives a lit `scene` makes no `load` call, and after an unlit `scene` exactly one with the map's `maxSide`. `lowPowerDefault`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/fogAdapter.test.ts tests/unit/play/gestures.test.ts tests/unit/play/sceneRequests.test.ts`. Expected: FAIL. (`SceneView` construction in jsdom must not need WebGL: split the asset-request decision into a pure `mapRequest(state, lowPower, maxTexture): { ref: AssetRef; maxSide: number } | null` in `SceneView.ts` and test that.)
- [ ] **Step 3: Implement.** `playScene.gpu.test.ts` (browser project): with a 512 × 512 map and fog `null`, the centre pixel of the canvas is the fog colour; with fog `[]`, it is the map's; with a lit scene, the canvas shows nothing of the map (all pixels equal the clear colour) and `LitPlaceholder` text is in the DOM.
- [ ] **Step 4: Run** the unit tests and `npx vitest run --project gpu tests/gpu/playScene.gpu.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: scene view with map, grid, fog, camera and gestures"`.

### Task 8: Tokens, pins and drawings

**Files:**
- Create: `apps/play/src/scene/TokenLayer.ts`, `apps/play/src/scene/tokenSprite.ts`, `apps/play/src/scene/PinLayer.ts`, `apps/play/src/scene/annotationAdapter.ts`, `apps/play/src/ui/TokenCard.tsx`
- Modify: `apps/play/src/scene/SceneView.ts`
- Test: `tests/unit/play/annotationAdapter.test.ts`, `tests/unit/play/tokenLayer.test.ts`, `tests/gpu/playTokens.gpu.test.ts`

**Interfaces:**
- Consumes: `SharedToken` (`ui.bars`, `ui.conditions`, `ui.nameplate`, `ui.downed`, `ring`, `art`), `computeTokenPixelSize`, `createGlyphTexture` / `MAP_ICON_SVG` for pins, `drawStroke` / `createTextElementView` with adapters.
- Produces: `sharedDrawingToStroke(d: SharedDrawing): DrawingStroke`, `sharedTextToElement(t: SharedText): TextElement` (map field for field; check `src/app/types.ts`); `class TokenLayer { constructor(assets: AssetLoader, lowPower: boolean); sync(tokens: readonly SharedToken[], mine: ReadonlySet<string>, selected: string | null): void; tokenAt(worldX: number, worldY: number): string | null; destroy(): void }` — one container per token id moved in place (no rebuild on position changes), list order = draw order, art as a circle-masked sprite of `size` px (a neutral disc until the art loads, `maxSide 512`), ring when `ring` is set, nameplate under the token when `ui.nameplate`, bars under it (colour, `current/max`, `static` drawn full), condition dots on the rim (colour; text glyph or icon), downed tokens greyed, the selected token outlined, own tokens marked with a small accent dot; `TokenCard` (opened by long press or tap on an own token) shows name, bars as numbers and conditions.

- [ ] **Step 1: Write the failing tests.** `annotationAdapter`: every field of a pen drawing, an icon drawing and a text survives the mapping (compare against hand-written `DrawingStroke` / `TextElement`). `tokenLayer` (pure part): `tokenAt` picks the last-listed token whose disc contains the point (`hitOrder(tokens, x, y): string | null` tested directly); a token whose position changes keeps its container (`sync` twice, same object identity via `containerOf(id)`).
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/annotationAdapter.test.ts tests/unit/play/tokenLayer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `playTokens.gpu.test.ts`: a token under covering fog is not visible (its centre pixel is the fog colour); a token outside fog is.
- [ ] **Step 4: Run** unit and gpu tests. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: tokens, pins and drawings"`.

### Task 9: Join flow and app wiring

**Files:**
- Create: `apps/play/src/app/PlayApp.tsx`, `apps/play/src/app/session.ts`, `apps/play/src/ui/JoinScreen.tsx`, `apps/play/src/ui/StatusBar.tsx`, `apps/play/src/ui/SettingsSheet.tsx`
- Modify: `apps/play/src/main.tsx`, `apps/play/src/ui/AppShell.tsx`
- Test: `tests/unit/play/joinScreen.test.tsx`, `tests/unit/play/session.test.ts`

**Interfaces:**
- Consumes: Tasks 3-8.
- Produces: `tableCodeOf(hash: string): string | null` (`#<26 chars of [a-z2-7]>` per `TABLE_CODE_PATTERN`, else null) in `session.ts`; `class Session { constructor(env: { origin: string; code: string; storage: Storage | null; open(url: string): SocketLike; indexedDB: IDBFactory | null }); join(as: JoinAs): void; leave(): void; readonly store: TableStoreApi; readonly assets: AssetLoader; readonly log: LogState; send(body: PlayerMessage): boolean }` — wires socket → feed → store / assets / `LogState.receive` (log messages) / `onPeople`; on `onSeat` writes the seat; on `your-code` writes the own code and shows it; on a refused key (`refusedKey`) forgets the seat and returns to the join form with the reason; on reconnect calls `feed.reset()` and `assets.tick()` keeps running every second.
- Screens: no valid code in the URL → "请从主持人给的链接打开 / Open the link your GM gave you"; a saved seat → join at once with its key, showing the name; else `JoinScreen` (name, max 32 chars through `playerName`; one 6-digit field for "加入码或你的个人代码 / Join code or your own code"); `waiting` → "等待主持人同意… / Waiting for the GM…"; `refused` → the close reason and a "重试 / Try again" button that returns to the form; joined → `StatusBar` (connection state, "主持人离线 / GM offline" banner while `gmOnline` is false), the scene, the panels (Task 10), and the own code once known ("你的个人代码 123 456，换设备时用它加入 / Your own code … use it on another device"). `SettingsSheet`: language (中文 / English, saves and reloads the page), low-power switch, own code, legal links.

- [ ] **Step 1: Write the failing tests.** `session`: `tableCodeOf('#' + 26 valid chars)` returns them; uppercase or 25 chars → null; with a fake socket: a saved seat makes a hello with `key` and no form; `welcome` writes the seat; a `refused` 4010 after a key-hello forgets the seat. `joinScreen` (jsdom, React Testing Library): the submit button is disabled for an empty or 33-char name and for a code that is not 6 digits; submitting calls `join({name, code})`; the legal links are present.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/session.test.ts tests/unit/play/joinScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: join flow, status bar and settings"`.

### Task 10: Panels: log and chat, dice tray, initiative, players, your turn

**Files:**
- Create: `apps/play/src/ui/PanelDock.tsx`, `apps/play/src/ui/LogPanel.tsx`, `apps/play/src/ui/DiceTray.tsx`, `apps/play/src/ui/diceFormula.ts`, `apps/play/src/ui/InitiativePanel.tsx`, `apps/play/src/ui/PlayersPanel.tsx`, `apps/play/src/ui/YourTurnBanner.tsx`, `apps/play/src/ui/panels.scss`
- Test: `tests/unit/play/diceFormula.test.ts`, `tests/unit/play/logActions.test.ts`, `tests/unit/play/yourTurnBanner.test.tsx`, `tests/unit/play/initiativePanel.test.tsx`

**Interfaces:**
- Consumes: `TableLogPanel`, `LogState`, `LogActions` (`tableLog/`), `Session.send`, `TableState`.
- Produces:
  - `logActions(send: (body: PlayerMessage) => boolean, scene: () => string | null, token: () => string | null): LogActions` — `say` → `{t:'chat', text, reply?, style?, speaker?, to?}`; `roll` → `{t:'roll', scene, formula, token, mode, flavor?, request?}` (no roll without a scene); `edit` → `chat-edit`; `remove` → `chat-delete`; `react` → `react`.
  - `type DiceDraft = { readonly dice: Readonly<Record<4 | 6 | 8 | 10 | 12 | 20 | 100, number>>; readonly modifier: number }`; `addDie(draft, faces): DiceDraft` (at most 20 of one kind), `formulaOf(draft): string | null` (`"2d20 + 1d6 + 3"`, largest die first, null when empty; must parse with `parseFormula` from `tools/parseFormula.ts`).
  - `PanelDock`: tabs 日志 / 骰子 / 先攻 / 玩家 (bottom sheet below 768 px, right side panel above; an unread count on the log tab from `LogState`); `DiceTray`: chips d4 d6 d8 d10 d12 d20 d100, modifier −/+, the formula, the mode as a four-way segmented control (公开 / 仅主持人 / 暗骰 / 仅自己, default 公开, remembered in `LogState.setRollMode`), Roll and Clear; the roll's `token` is the first own token in list order or null; `roll-refused` shows its reason; `InitiativePanel`: round, combatants in order with art (`maxSide 512`), name or "未知 / Unknown" for `name: null`, the turn highlighted, defeated struck through, sides when `bySides`; `PlayersPanel`: `people` with the GM first, away players dimmed, self marked "你 / You"; `YourTurnBanner`: shown when `yourTurnAt` is set, "轮到你了！/ Your turn!", dismissed by tap or after 8 s, calls `navigator.vibrate?.([200, 100, 200])` once when shown and not in low-power mode.

- [ ] **Step 1: Write the failing tests.** `diceFormula`: chips d20, d20, d6 and modifier +3 → `"2d20 + 1d6 + 3"`, which `parseFormula` accepts; empty → null; 21st d6 ignored; modifier −2 → `"1d8 - 2"`. `logActions`: each action produces its exact message; `roll` without a scene sends nothing; mode `blind` is passed through. `yourTurnBanner` (jsdom, fake timers): appears on `yourTurnAt`, vibrates once (spy), hides after 8 s, not vibrating in low-power mode. `initiativePanel`: three combatants render in order with the turn marked and a `name: null` combatant as "未知".
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/diceFormula.test.ts tests/unit/play/logActions.test.ts tests/unit/play/yourTurnBanner.test.tsx tests/unit/play/initiativePanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: log and chat, dice tray, initiative, players and your-turn banner"`.

### Task 11: End to end: GM, relay, player app, real browser

**Files:**
- Create: `tests/unit/play/endToEnd.test.ts`, `tests/e2e/playPage.e2e.test.ts`
- Modify: `vitest.config.mts` (project `play-e2e`: environment node, include `tests/e2e/**/*.e2e.test.ts`, not part of `unit`), root `package.json` (`"test:play-e2e": "npm run build:play && vitest run --project play-e2e"`), `apps/play/README.md`, `apps/relay/README.md` (STATIC_DIR = `apps/play/dist`), `docs/fork/FORK_GUIDE.md`, `docs/fork/online-followups.md`

**Interfaces:**
- Consumes: the GM end-to-end setup of `tests/unit/relay/endToEnd.test.ts` (real `OnlineControl` + real relay via `relayHarness.ts`), `Session` (Task 9) with `open` = a `ws` client sending `Origin: TEST_PUBLIC_ORIGIN`.

- [ ] **Step 1: Write the tests.** `endToEnd.test.ts` (node): the GM hosts a table with an unlit scene (map PNG, two tokens, one owned by the joining player), a `Session` joins with the join code, the GM admits it; the player's store reaches mode `map` with both tokens; the map asset loads and verifies; a `self` roll from the player arrives in its own `LogState` and the GM's log, and in no second player's; `your-turn` arrives when the GM gives the player's token the turn; the GM switches the scene to lit → the player's mode becomes `lit-placeholder` and no `asset-request` for that map is sent; the relay restarts → the session reconnects with its key and resyncs. `playPage.e2e.test.ts`: start the relay with `STATIC_DIR=apps/play/dist`, open the join link in Playwright Chromium (from the installed `playwright` package), assert no console message mentions "Content Security Policy", the join form renders in Chinese, and after joining (a headless GM from the relay harness) the canvas exists and `document.title` is the Chinese title.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/endToEnd.test.ts && npm run test:play-e2e`. Expected: PASS (fix only wiring found broken; a design gap is reported, not patched around).
- [ ] **Step 3: Docs.** `apps/play/README.md`: dev (`npm run relay` with `PUBLIC_ORIGIN=http://localhost:5173` and `npm run dev:play`), build, what M3 covers and that lit scenes show a placeholder until Plan 2b. Follow-ups found during the plan go to `docs/fork/online-followups.md` under a new "Player app (`apps/play`)" heading.
- [ ] **Step 4: Full check.** `npx tsc --noEmit && npm run check:play && npm run check:relay && npm run check:boundaries && npm run lint && npx vitest run --project unit && npm run build && npm run build:play`. Expected: all exit 0.
- [ ] **Step 5: Commit** `git commit -m "Play: end-to-end tests with the GM, the relay and a real browser"`.

---

## Reference: shared code the tasks reuse (verified 2026-10-26)

- Relay frames, hello, close codes: `src/app/online/protocol/relay.ts` (`parseRelayFrame` :244, `PlayerHello` :81, `CLOSE` :37-58, `FINAL_CLOSE_CODES` :67, `KEEPALIVE_*` :21-23, `MAX_PLAYER_FRAME` :30). The relay rebuilds the hello from a fixed field list, so the fork level travels in the `client` message, never in the hello.
- GM messages: `parseGmMessage` `game.ts:197`; `part` `game.ts:68`, `MAX_PARTS` 64; `parseYourCode` `seat.ts:35` (not in `parseGmMessage`); `DeltaReader` `deltaReader.ts:13`; assets `asset.ts` (`AssetVariant` :47: `width` × `height` is the size to draw at).
- Shapes: `SharedScene` `game.ts:22`, `SharedToken` `tokens.ts:30`, `SharedFog` `fog.ts:17-26`, `SharedGrid` / `SharedPin` / `SharedDrawing` / `SharedText` `mapLayers.ts:34-111`, `SharedInitiative` `initiative.ts:69`, `SharedRules` `rules.ts:32`, `TablePerson` `chat.ts:38`, `RollMode` `chat.ts:13`.
- Drawing: `GridSystem` `src/app/grid/GridSystem.ts`, `FogCanvasCompositor` `src/app/pixi/fog/FogCanvasCompositor.ts` (takes Atlas `FogOperation`), `fogCoverage` `src/app/fog/fogCoverage.ts`, `drawStroke` `src/app/pixi/drawingLayer.ts`, `createTextElementView` `src/app/pixi/textElementView.ts`, `computeTokenPixelSize` `src/app/pixi/token-renderer/tokenSizing.ts`, `MAP_ICON_SVG` `src/app/pixi/mapIcons.ts`, `createGlyphTexture` `src/app/pixi/utils/pinIconTexture.ts`. Atlas's token renderer is not shared; tokens are drawn by the app.
- UI: `TableLogPanel`, `LogState`, `LogActions` (`src/app/online/tableLog/`, props `panelTypes.ts:54`, test template `tests/unit/online/tableLog/TableLogPanel.test.tsx`). Its SCSS uses Obsidian CSS variables (defined by `apps/play/src/theme.scss`).
- DOM host: `installDomHost` `src/app/host/dom.ts` (reference implementation `tests/setup/domHost.ts`); `t()` runs at module load in `tableLog/TableLogPanel.tsx:17`, so `setLocale` first.
- GM side: player messages enter at `OnlineTable.ts:192`, scene messages in `SceneShare.ts:215`; turn set `sharedTurnTokens` (`gm/turnShare.ts`), used in `TokenShare.ts:248-251`; ownership `gm/ownership.ts`; roll audiences `rollAudience` / `buttonMode` `gm/PlayerRolls.ts:24,32`. Harnesses: `shareHarness.ts`, `controlHarness.ts`, `fakeSeats.ts`, relay `relayHarness.ts`, `headlessPlayer.ts`.
- Known limit carried over from upstream's protocol: the map's stretch (`GridState.mapStretch`) is not shared, so a stretched map is drawn unstretched for players; recorded as a follow-up, not fixed here.
