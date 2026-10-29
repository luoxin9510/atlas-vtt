# Online follow-ups, wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the follow-ups that a GM or a player on a mainland phone would notice first: a smaller player page, art that comes back after a reconnect, honest self-hosted settings, a visible reason when image uploads fail, Chinese polish, and the Plan 3 deploy-tool residuals.

**Architecture:** Small independent changes on top of Plan 3 (branch `feature/online-followups-a`, stacked on `feature/m5-m6-notes-deploy` / PR #4). No protocol change (fork level stays 3).

**Tech Stack:** TypeScript, React 19, Vite (dynamic `import()` chunks), vitest 4, Node >= 22.18.

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (G-goals on phones in mainland China, 6.3, 6.5). Source list: `docs/fork/online-followups.md` (items quoted in each task).

## Global Constraints

- Anti-goal unchanged: nothing the GM hides reaches a player; no secret (host key, table secret, ticket, signing key) in any log line or UI text.
- Upstream conventions (`docs/fork/FORK_GUIDE.md`): explicit return types, no `any`, no inline eslint-disable / ts-ignore, files under ~300 lines, UI text through `t()` with en + zh keys, Chinese per `docs/fork/zh-glossary.md`. Never change `manifest.json`, `versions.json`, LICENSE, THIRD_PARTY_NOTICES.md existing entries.
- After every task: `npx tsc --noEmit`, `npm run check:play`, `npm run check:relay`, `npm run check:boundaries`, `npm run lint`, `npx vitest run --project unit` green; tasks touching `apps/play` also `npm run build:play`.
- Each task strikes (deletes) the follow-up lines it resolves in `docs/fork/online-followups.md`.

## Review Focus

1. A Chinese phone opening the join link: the page renders in Chinese on first paint (no English flash longer than the zh chunk load) and still renders English if the zh chunk fails to load (Task 1 tests `renders zh after loading its chunk`, `falls back to English when the chunk fails`).
2. A phone that loses the table while token art is loading: the art loads once the connection is back, without the token list changing (Task 2 test `asks again for failed art after reconnect`).
3. A GM entering `http://203.0.113.5:8787`: a visible warning that the host key travels unencrypted; loopback `http://127.0.0.1` and `http://localhost` get none (Task 3 tests).

---

### Task 1: Load the player page's non-English language on demand

Follow-up: "The main chunk is about 542 kB (all locales): split it for mainland mobile networks."

**Files:**
- Modify: `apps/play/src/i18nInit.ts`, `apps/play/src/main.tsx`
- Create: `src/app/i18n/lazyLanguages.ts` (shared: a map from language code to `() => Promise<Translation>` using dynamic `import()` of `./locales/<code>/index.ts`; English is not in it)
- Test: `tests/unit/play/i18nInit.test.ts` (create or extend)

**Interfaces:**
- Produces: `export const LAZY_TRANSLATIONS: Readonly<Record<string, () => Promise<Translation>>>` (same keys as `TRANSLATIONS` minus `en`); `initLanguage(storage, browserLanguage, loaders = LAZY_TRANSLATIONS): Promise<string>` — resolves the code with `resolveLocale` over the loader keys plus `en`, awaits that one loader, then `setLocale(code, { en, [code]: loaded })`; on a loader rejection it sets English and resolves `'en'`.
- `main.tsx` awaits `initLanguage(...)` before `createRoot(...).render(...)`. The plugin keeps using `TRANSLATIONS` unchanged; `apps/play` no longer imports `src/app/i18n/languages.ts`.

- [ ] **Step 1: Write the failing tests:** `renders zh after loading its chunk` (stored choice `zh`, loader resolves the real zh translation → `t('onlinePlay.tab.notes')` is the zh text); `picks the base language` (`zh-CN` browser → zh loader called once); `falls back to English when the chunk fails` (loader rejects → resolves `'en'`, `t` gives English); English choice calls no loader.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/i18nInit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check `scripts/boundaries.mjs` lets `apps/play` import the new shared file (add it to the shared include if needed).
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`; record the main chunk size before and after (expected: the zh and ru locales are separate chunks and the main chunk shrinks by their size). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: load the page's language on demand"`.

### Task 2: Ask again for art that failed while the table was unreachable

Follow-up: "Token and initiative art that fails while the table is unreachable is not asked for again until the token list changes (only the map download retries)."

**Files:**
- Modify: `apps/play/src/assets/useAssetUrl.ts` (shared by token art in `InitiativePanel`, note images), the token-art loader in `apps/play/src/scene/` that calls `assets.load` for sprites (find it), `apps/play/src/assets/AssetLoader.ts` only if it needs a "connection came back" signal (it has `setConnected(on)`)
- Test: `tests/unit/play/assetRetry.test.ts`

**Interfaces:**
- Produces: `AssetLoader.onReconnect(listener: () => void): () => void` (called when `setConnected(true)` follows `false`); users of `assets.load` that got `null` while disconnected (or whose load failed) load again once on the next reconnect. Successful loads are never repeated.

- [ ] **Step 1: Write the failing test** `asks again for failed art after reconnect`: a token sprite and an initiative portrait whose loads return `null` while disconnected → after `setConnected(true)` each asks once more and shows the art; a load that succeeded asks nothing.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: ask again for art that failed while offline"`.

### Task 3: Honest settings on a self-hosted server

Follow-ups: "`normalizeServerOrigin` accepts `http://` for any host; the host key then travels in clear text. Consider a warning for non-loopback `http:`."; "Feedback texts mention 'the Atlas team', wrong on a self-hosted server."; "On a self-hosted server the settings show both an 'Online account' row ('Host key set') and the 'Host key' row."; "`protocol/diagnostics.ts` `feedbackNote()` is unused and duplicated by `onlineDock.feedback.*` keys."

**Files:**
- Modify: `src/app/online/gm/serverSettings.ts`, `src/app/online/gm/settings.ts` (account section), the feedback strings in `src/app/i18n/locales/{en,zh}/onlineDock.ts` (and `ru` only if it has the same key — keep it in step or delete the key there too), `src/app/online/protocol/diagnostics.ts`
- Test: `tests/unit/online/gm/serverSettings.test.ts` (or the file testing it), `tests/unit/online/gm/onlineSettings.test.ts`

**Interfaces:**
- Produces: `isCleartextRemote(origin: string): boolean` (true for `http:` when the host is not `localhost`, `127.0.0.0/8`, `::1`); the server row shows "Not encrypted: the host key is sent in clear text. Use https:// for a server on another machine. / 未加密：主持密钥会以明文发送。另一台机器上的服务器请使用 https://。" under the address while it is true. When a self-hosted server is set, the "Online account" row is not shown (only the Host key row). Feedback texts say "the server's operator / 服务器管理员" instead of "the Atlas team" when a self-hosted server is set (two keys, picked by the setting). `feedbackNote()` is removed.

- [ ] **Step 1: Write the failing tests:** `isCleartextRemote` cases (`http://203.0.113.5:8787` true, `http://localhost:8787`, `http://127.0.0.1`, `http://[::1]:8787`, `https://play.example.com` false); the warning row appears/disappears with the address; self-hosted settings list no account row; feedback text names the operator when self-hosted.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: honest settings on a self-hosted server"`.

### Task 4: Tell the GM why images go over the socket

Follow-up: "A failed GM-side upload to the image cache writes no log line, so the GM cannot see why images arrive over the socket."

**Files:**
- Modify: `src/app/online/gm/assetUpload/uploadAsset.ts` / `AssetTickets.ts` (where a failed upload or mint is decided), the place the dock shows status, `src/app/i18n/locales/{en,zh}/onlineDock.ts`
- Test: the upload tests in `tests/unit/online/gm/assetUpload/`

**Interfaces:**
- Produces: on the first failed upload or mint of a table session (status 413/415/422/429/507, network error), one dock status line "Image cache unavailable (<reason>): images go to players directly. / 图片缓存不可用（<原因>）：图片改由主持人直接发送。" where reason is one of: full (507), busy (429), refused (413/415/422), unreachable (network). Shown until the next successful upload. Never includes a URL, hash, secret or file name. Also remember a 429/507 mint for 60 s so new players do not each ask again (follow-up "a 429 or 507 mint is not remembered").

- [ ] **Step 1: Write the failing tests:** each status maps to its reason line; the line clears after a success; a 507 mint is not retried within 60 s (fake clock) and is after; no line text contains the table code, hash or a secret.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: say when the image cache is unavailable"`.

### Task 5: Chinese polish

Follow-up: "zh polish: `请求{button}` spacing, `由 你 发现`, `线上玩家` -> `联机玩家`; add 悄悄话, 讨论串, 中转服务器 to `zh-glossary.md`."

**Files:**
- Modify: `src/app/i18n/locales/zh/*.ts` (online files), `docs/fork/zh-glossary.md`
- Test: the existing locale tests (placeholders kept)

- [ ] **Step 1:** grep the zh online locale files for the three patterns and every other `线上玩家`; list each change in the report.
- [ ] **Step 2: Implement** the text changes; add the three glossary terms with their English source and key.
- [ ] **Step 3: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 4: Commit** `git commit -m "zh: polish online texts and glossary"`.

### Task 6: Deploy-tool residuals from Plan 3

Residuals (Plan 3 ledger): repeated `wake()` re-arms the dead timer and delays detection; `wake()` does not reset the backoff attempt; the bundle tgz carries macOS xattr headers; the probe sends `HOST_KEY` over a non-local `http:` origin without a word; the bundle scanner ignores bare npm specifiers other than `ws`; the bundle test writes a stray file into the real `apps/relay/src`.

**Files:**
- Modify: `apps/play/src/net/TableSocket.ts`, `scripts/bundle-relay.mjs`, `scripts/relay-probe.mjs`, `tests/unit/play/tableSocket.test.ts`, `tests/unit/relay/bundle.test.ts`

**Interfaces:**
- `wake()` on an open socket sends the ping but arms the dead timer only when none is pending; `wake()` with no socket also resets the backoff attempt to 0.
- The bundler packs with `COPYFILE_DISABLE=1` (and `--no-xattrs` where tar supports it) so GNU tar extracts without warnings; it throws on any bare import specifier other than `ws` and `node:*`; it takes `--source-root <dir>` (default the repo) so the test builds a stray-import tree in a temp dir.
- The probe refuses a non-loopback `http:` origin unless `--insecure` is given.

- [ ] **Step 1: Write the failing tests** for each behaviour (wake twice within 5 s → dead detection still at 20 s after the first; wake after failures → next retry uses the first backoff step; bundle from a temp tree with `import x from 'left-pad'` throws; stray-import test uses the temp tree).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**; check the tgz with `tar -tvf` shows no `LIBARCHIVE.xattr` headers (`tar --list --verbose` on macOS, or `bsdtar`), and the probe refusal by hand.
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Deploy tools: wake timers, clean bundles, stricter probe"`.

## Rulings in this plan

- Only the player page splits languages; the plugin bundle is out of scope (Obsidian loads it from disk).
- The cleartext warning is a warning, not a block: a GM on a LAN without TLS may still choose it.
- Other follow-ups (relay memory budget, close-frame ordering, OnlineTable size) wait for a later wave: no user sees them in a small game.
