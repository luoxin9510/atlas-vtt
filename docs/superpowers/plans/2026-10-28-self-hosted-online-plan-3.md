# Self-hosted online play, Plan 3 (M5 shared notes, M6 deployment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM shares chosen vault notes with players (a copy built by an allowlist over a Markdown syntax tree, GM-only parts never leaving Obsidian), players read them in a Notes panel on their phones, and the relay runs in production on the existing Hetzner VPS at `https://play.xinsawi.com` behind Cloudflare Tunnel, checked with a real game on phones.

**Architecture:** (1) Fork protocol level 3 adds the `notes` list. (2) The GM client parses each shared note with micromark/mdast plus a small Obsidian syntax extension (wikilinks, embeds, `%%comments%%`), copies only allowed nodes into a new tree with links and images resolved, serialises it back to Markdown and serves it as a `text/markdown` asset; a hash leaving the shared set has its queued chunks dropped and later requests refused. (3) The player app re-parses that Markdown and renders the mdast straight into React elements through an element allowlist (no HTML string ever exists). (4) M6 bundles the relay with the built player app, runs it as a systemd service on the VPS on localhost, and publishes it through the existing `abs` tunnel.

**Tech Stack:** TypeScript, React 19.3.1, zustand 5, vitest 4 (unit / gpu / play-e2e), Node >= 22.18 (relay), `mdast-util-from-markdown` 2.1.0, `mdast-util-to-markdown` 2.2.0, `micromark-extension-gfm` 3.0.0 + `mdast-util-gfm` 3.1.0, `micromark-extension-math` 3.1.0 + `mdast-util-math` 3.0.0, `micromark-extension-frontmatter` 2.0.0 + `mdast-util-frontmatter` 2.0.1, `micromark-util-types` 2.0.3 (types for the extension), `@types/mdast` 4.0.4; systemd, cloudflared.

**Spec:** `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md` (6.4, 6.5 as amended 2026-10-28, 7, 8). Contract: `docs/fork/online-contract.md`. Residuals of earlier plans: `docs/fork/online-followups.md`.

## Global Constraints

- Anti-goal: nothing the GM hides reaches a player. For notes that is: unshared notes, their text, titles, paths and folders; `[!gm]` callouts (any case, folded or not, nested at any depth, with everything inside); `%%comments%%` (an unclosed `%%` hides the rest of the note, as in Obsidian); raw HTML and HTML comments; frontmatter; code blocks whose language is not on the plain list; footnote and reference-link definitions; math; block ids; the typed target of any link; image file names and paths. Unknown node kinds are dropped with their content (allowlist, fail closed).
- Shared means frontmatter `atlas-share` is exactly the boolean `true` (read from `app.metadataCache.getFileCache(file)?.frontmatter`); `"true"`, `yes`, `1` are not shared. Only shared notes are read for players. The display group is `atlas-share-group` when it is a string, cleaned with `bookLine(value, 60)`; titles are the file's basename, `bookLine(title, 120)`. At most 500 notes in the list (by title order; the rest are not shared and the dock says so).
- Copy rules (spec 6.4): kept node kinds are heading, paragraph, text, emphasis, strong, delete, inlineCode, code (only when its language is empty or in `PLAIN_CODE_LANGUAGES`; the language itself is not sent), list, listItem (with `checked`), table, tableRow, tableCell, thematicBreak, blockquote, break, callouts other than `[!gm]`, links and images as resolved. A callout's type is kept only when it is in `CALLOUT_TYPES` (the standard Obsidian types: note, abstract, summary, tldr, info, todo, tip, hint, important, success, check, done, question, help, faq, warning, caution, attention, failure, fail, missing, danger, error, bug, example, quote, cite), else it becomes a plain quote; its title is kept as plain text only.
- Links: a wikilink, wiki embed of a note, or Markdown link without a scheme resolves with `app.metadataCache.getFirstLinkpathDest(linkpath, notePath)`. Target a shared note → in-app link `atlas-note:<id>` whose text is the alias, else the link text, else (unaliased wikilink) the target's title plus ` › heading` when a heading fragment was given. Any other target (unshared, unresolved, not Markdown) → the alias or Markdown link text as plain text; an unaliased wikilink is dropped entirely (its only visible text would be the typed target). `https:` URLs are kept; every other scheme (and GFM's `www.` autolinks, which become `http:`) becomes its text. Reference links (`[text][ref]`, `[ref]`) become their text.
- Images: `![[file|caption|300]]` and `![alt](path)` of a vault image (`isImagePath`) → `![caption](atlas-asset:<hash>?size=<bytes>&mime=<type>)` using `QuestImages`' ref; the caption is kept only when the author wrote one (a part after `|` that is a size `\d+` or `\d+x\d+` is no caption); never the file name. Remote images (`https:` or any scheme), non-image files and embeds of unshared notes are dropped; `![[shared note]]` becomes a link to it. Embedded content is never inlined.
- Fork protocol: `FORK_PROTOCOL_LEVEL = 3`, `export const NOTES_LEVEL = 3` (explicit, never `FORK_PROTOCOL_LEVEL`). `notes` goes only to players whose recorded level is `>= 3`, after every `client` message and on join/reconnect; lower levels never get it.
- Serving: note texts are served only as socket chunks (never ticketed); note images through `PictureAssets.artPath` like other art (ticketed for level >= 2). Every hash that leaves the current shared set (note unshared, edited, renamed out of the set, deleted, image no longer referenced) has its queued chunks dropped for every player and later `asset-request`s answered `asset-refused`.
- Secrets and logs: no note title, group, path or text in any log line, diagnostics or error report. The host key, tickets, table secrets and the ticket signing key are never logged or printed; VPS secrets in `~/Developer/vps-setup/` are never printed or copied into the repo or the transcript.
- Production (spec 6.5 as amended): the relay listens on `127.0.0.1:8787` on the Hetzner VPS with `TRUST_PROXY=cf`, `PUBLIC_ORIGIN=https://play.xinsawi.com`, published as a new public hostname on the existing `abs` cloudflared tunnel. Nothing else on the VPS changes: xray (TCP 443, 2096), Hysteria2 (UDP 8443), the `abs` tunnel's existing routes, Audiobookshelf, rclone and pi-web stay as they are. Every step that touches the VPS or Cloudflare waits for the user's go-ahead.
- Dependencies: new packages installed with `--save-exact` at the versions in Tech Stack, resolved with `npm install --before=2026-10-14` so no transitive version is younger than two weeks; licences (all MIT) added to `THIRD_PARTY_NOTICES.md` only if the file already lists bundled npm packages (check its format; never alter existing entries). Player-side imports (`mdast-util-from-markdown`, `micromark-extension-gfm`, `mdast-util-gfm`, `mdast`) go into `play.packages` in `scripts/boundaries.mjs`; GM-side code is plugin code and needs no list change.
- Upstream conventions (`docs/fork/FORK_GUIDE.md`): explicit return types, no `any`, no inline eslint-disable / ts-ignore, files under ~300 lines, UI text through `t()` with keys in `locales/en/` and `locales/zh/` (`onlinePlay.*` for the app, `onlineDock.*` / `onlineGm.*` for the GM), Chinese per `docs/fork/zh-glossary.md` (add 共享笔记, 分组). After every task: `npx tsc --noEmit`, `npm run check:play`, `npm run check:relay`, `npm run check:boundaries`, `npm run lint`, `npx vitest run --project unit` green; tasks touching `apps/play` also `npm run build:play`.
- `OnlineTable.ts` (399 lines, 11 constructor params) grows by at most a few lines: notes wiring lives in a factory `tableNotes(...)`, like `tableBook(...)`.
- Tests: GM in `tests/unit/online/`, player in `tests/unit/play/`, relay in `tests/unit/relay/`, browser end-to-end in `tests/e2e/`.

## Review Focus

1. The GM hides a passage mid-game (wraps it in `[!gm]` or `%%`) or unshares the note while a player's download is still queued: the old hash's queued chunks are gone, a re-request is refused, and the list no longer offers it (Task 5 tests `drops queued chunks when a note is edited to hide a passage`, `refuses the old hash after unsharing`).
2. Hostile or odd Markdown the GM never meant as structure: `<script>`, `<img onerror>`, `javascript:` and `data:` links, `[!GM]` in capitals, a `[!gm]` nested inside an `[!info]`, a `%%` that never closes, a wikilink inside a table cell or callout title, a reference definition pointing at a note path: nothing of it reaches the copy (Task 3 `notesLeak.test.ts` seeded trials) and the player renderer drops what a crafted copy could still carry (Task 7 `renders only allowed elements`).
3. A note renamed, moved, deleted, or linked from another shared note while unshared and then shared: the list, the ids and the in-app links follow on the next change, and a link never names an unshared note (Task 5 `follows renames and flag changes`).
4. A phone that sleeps or switches network during a game: the player app reconnects within seconds of waking, without the GM doing anything (Task 10 `reconnects when the page becomes visible`).
5. The relay behind Cloudflare: a 320 KiB GM frame passes, an idle table survives past Cloudflare's idle timeout on the 30 s ping, an 8 MiB image part uploads, and a wrong host key five times locks only the offending address (`TRUST_PROXY=cf`) (Task 11 probe, recorded in `docs/fork/deployment.md`).

---

### Task 1: Fork protocol level 3 (`notes` list, note link and image URLs)

**Files:**
- Create: `src/app/online/protocol/noteLinks.ts`
- Modify: `src/app/online/protocol/fork.ts` (level, `NOTES_LEVEL`, `NotesMessage`, `parseNotes`), `game.ts` (`GmMessage` union, `parseGmMessage` case beside `pause`), `protocol/index.ts` (exports), `docs/fork/online-contract.md` (fork messages, level 3), tests asserting level 2 (`tests/unit/online/protocol/fork.test.ts:6`, `tests/unit/play/tableSocket.test.ts:75,97`, `tests/unit/play/endToEnd.test.ts:288`); `apps/play` exhaustive switches ignore `notes` for now
- Test: `tests/unit/online/protocol/fork.test.ts`, `tests/unit/online/protocol/noteLinks.test.ts`

**Interfaces:**
- Produces (`fork.ts`): `FORK_PROTOCOL_LEVEL = 3` (doc comment gains "3: notes"); `export const NOTES_LEVEL = 3`; `export interface SharedNote { readonly id: string; readonly title: string; readonly group?: string; readonly text: AssetRef }`; `export interface NotesMessage { readonly t: 'notes'; readonly notes: readonly SharedNote[] }`; `parseNotes(value: Record<string, unknown>): NotesMessage | null` — `id` matches `NOTE_ID_PATTERN = /^[0-9a-f]{24}$/`, `title` 1..120 chars and `group` 1..60 chars after `bookLine` cleaning (a value that changes under cleaning is rejected, not cleaned), `text` passes `parseTextAsset`, at most `MAX_SHARED_NOTES = 500`, ids unique; any bad entry rejects the message.
- Produces (`noteLinks.ts`, pure, shared): `noteHref(id: string): string` → `atlas-note:<id>`; `noteIdOf(href: string): string | null`; `assetImageHref(ref: AssetRef): string` → `atlas-asset:<hash>?size=<n>&mime=<type>`; `assetImageOf(href: string): AssetRef | null` (only image MIME types via `parseAsset`); `isHttpsUrl(href: string): boolean` (`new URL` parse, protocol exactly `https:`, no credentials); `export const CALLOUT_TYPES: ReadonlySet<string>` (list in Global Constraints); `calloutHead(line: string): { type: string; fold: '' | '+' | '-'; title: string } | null` — reads `[!type]`, optional `+`/`-`, rest of the line as title, type lowercased; written as a character scanner, no regex over more than the type token.

- [ ] **Step 1: Write the failing tests.** `fork.test.ts`: level is 3, `NOTES_LEVEL` is 3; a valid `notes` message parses; a 23-char id, a title of 121 chars, a title with a control character, duplicate ids, 501 notes, a `text` with `mime:'image/png'` → null. `noteLinks.test.ts`: round trips of `noteHref`/`noteIdOf` and `assetImageHref`/`assetImageOf`; `assetImageOf('atlas-asset:<hash>?size=1&mime=text/markdown')` → null; `isHttpsUrl` true for `https://a.b/c`, false for `http:`, `javascript:alert(1)`, `HTTPS://user:pw@x`, `obsidian://open`, `//x`; `calloutHead('[!GM]- Secret')` → `{type:'gm', fold:'-', title:'Secret'}`, `calloutHead('[!info]')` → title `''`, `calloutHead('[ !info]')` → null.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/protocol`. Expected: FAIL.
- [ ] **Step 3: Implement** the above; update the level-2 assertions to 3 and the contract doc (fork messages list gains `notes`, level 3 line, the two URL forms).
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Protocol: fork level 3 with the shared notes list"`.

### Task 2: Markdown dependencies and the Obsidian syntax parser (GM)

**Files:**
- Create: `src/app/online/gm/notes/obsidianSyntax.ts` (micromark extension), `src/app/online/gm/notes/obsidianFromMarkdown.ts` (mdast handlers), `src/app/online/gm/notes/parseNote.ts`
- Modify: `package.json`, `package-lock.json`
- Test: `tests/unit/online/gm/notes/parseNote.test.ts`

**Interfaces:**
- Produces: `parseNote(text: string): Root` (mdast `Root`) with extensions gfm, math, frontmatter (`yaml`), and Obsidian syntax. New mdast nodes (declared by module augmentation of `mdast`'s `PhrasingContentMap` / `RootContentMap`): `WikiLink { type: 'wikiLink'; target: string; alias: string | null; embed: boolean }` (target is the raw text before the first `|`, including `#heading` / `#^block`; alias is the rest, may contain `|`) and `ObsidianComment { type: 'obsidianComment'; closed: boolean }` (inline and flow; content is not kept on the node).
- Construct rules: `[[` … `]]` on one line, no `[`/`]` inside, at least one character; `![[` the same with `embed: true`; both take precedence over link and label starts. `%%` opens a comment that ends at the next `%%`; inline inside a paragraph, flow when a line starts with `%%` (spans lines and blocks until the closing `%%` line). Inside code spans and fenced code `%%` and `[[` are literal. A comment that reaches the end of its paragraph (inline) or of the document (flow) unclosed is `closed: false`.

- [ ] **Step 1: Install** `npm install --save-exact --before=2026-10-14 mdast-util-from-markdown@2.1.0 mdast-util-to-markdown@2.2.0 micromark-extension-gfm@3.0.0 mdast-util-gfm@3.1.0 micromark-extension-math@3.1.0 mdast-util-math@3.0.0 micromark-extension-frontmatter@2.0.0 mdast-util-frontmatter@2.0.1` and `npm install --save-exact --save-dev --before=2026-10-14 micromark-util-types@2.0.3 @types/mdast@4.0.4`. Check `npm run build` still bundles (ESM-only packages).
- [ ] **Step 2: Write the failing tests:** `[[A|b]]` → one `wikiLink {target:'A', alias:'b', embed:false}`; `![[map.png|Cave|300]]` → `embed:true`, alias `'Cave|300'`; `[[Note#Head|x]]` target `'Note#Head'`; in a GFM table cell `[[A\|b]]` → one wikiLink with alias `b`; `` `[[A]]` `` stays inline code; `[[A]]` when a definition `[A]: x` exists is still a wikiLink; `a %%x%% b` → text, comment, text with no `x` anywhere in the tree; a flow comment over two paragraphs and a list leaves nothing of them; an unclosed flow `%%` → one `closed:false` comment and nothing after it; frontmatter → a `yaml` node; `$x$` and `$$\n…\n$$` → `inlineMath` / `math`; `[^1]` and `[^1]: t` → `footnoteReference` / `footnoteDefinition`; `<b>x</b>` → `html` nodes.
- [ ] **Step 3: Run** `npx vitest run --project unit tests/unit/online/gm/notes/parseNote.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the extension with micromark's tokenizer API (`Extension` with `text` for codes `[`, `!`, `%` and `flow` for `%`, `add: 'before'`), and the `fromMarkdown` handlers that build the two node types. No regular expressions over the source.
- [ ] **Step 5: Verify** the per-task checks and `npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "GM: parse notes with micromark and Obsidian syntax"`.

### Task 3: The player copy (allowlist, links, images) and its leak tests

**Files:**
- Create: `src/app/online/gm/notes/playerCopy.ts` (tree walk), `src/app/online/gm/notes/copyLinks.ts` (link, embed and image resolution), `src/app/online/gm/notes/plainLanguages.ts`
- Test: `tests/unit/online/gm/notes/playerCopy.test.ts`, `tests/unit/online/gm/notesLeak.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `WikiLink`, `ObsidianComment` (Task 2); `noteHref`, `assetImageHref`, `isHttpsUrl`, `calloutHead`, `CALLOUT_TYPES` (Task 1).
- Produces: `interface CopyTargets { note(linkpath: string): { id: string; title: string } | null; image(linkpath: string): Promise<AssetRef | null> }` (the share answers `note` only for shared notes, `image` only for vault images); `interface PlayerCopy { readonly markdown: string; readonly images: ReadonlyMap<string, string> }` (image hash → vault path, for serving); `copyForPlayers(tree: Root, targets: CopyTargets): Promise<PlayerCopy>`; `export const PLAIN_CODE_LANGUAGES: ReadonlySet<string>` (none, text, txt, plain, js, javascript, jsx, ts, typescript, tsx, json, yaml, yml, toml, ini, sh, bash, zsh, shell, console, powershell, ps1, bat, python, py, ruby, rb, go, rust, rs, c, cpp, h, hpp, cs, csharp, java, kotlin, swift, php, sql, html, css, scss, xml, markdown, md, diff, lua, r, perl, haskell, elixir, erlang, clojure, scala, dart, verilog, systemverilog, vhdl, tcl, makefile, dockerfile, latex, tex; compared lowercased).
- Behaviour: builds a new mdast tree from kept nodes only (never mutates or filters the parsed one), applies the Global Constraints' copy, link and image rules, strips a trailing ` ^block-id` token from the last text of a paragraph, heading or list item (a scanner over that one text value) and drops a paragraph that is only a block id; an `obsidianComment` with `closed:false` ends the copy at that point (nothing after it in document order). A callout is a blockquote whose first paragraph's first text starts with a `calloutHead`; `[!gm]` drops the whole blockquote; others are rebuilt as `> [!type] Title` (or a plain blockquote for unknown types). Serialised with `toMarkdown(tree, { extensions: [gfmToMarkdown()] })`; a copy whose root ends up empty is `''`.

- [ ] **Step 1: Write the failing tests.** `playerCopy.test.ts`, one per rule with exact expected Markdown: headings, emphasis, tables, task lists survive; `[[Shared|see]]` → `[see](atlas-note:<id>)`; `[[Shared#Fight]]` → `[Shared › Fight](atlas-note:<id>)`; `[[Secret|the vault]]` → `the vault`; `[[Secret]]` → nothing; `[x](Secret.md)` → `x`; `[x](https://a.b)` kept, `[x](http://a.b)`, `[x](javascript:alert(1))`, `[x](obsidian://open?vault=v)` → `x`; `www.a.b` → `www.a.b` as text; `[t][r]` + `[r]: Secret.md` → `t`, no `Secret`; `![[map.png]]` → `![](atlas-asset:…)` and `images` maps the hash to `map.png`; `![[map.png|Cave|300]]` → alt `Cave`; `![[map.png|300]]` → empty alt; `![x](https://cdn/x.png)` → nothing; `![[Shared]]` → link; `![[Secret]]` → nothing; `[!gm]` / `[!GM]-` callouts and a `[!gm]` inside an `[!info]` → gone with their content; `[!info]+ Title with [[Secret|alias]]` → `> [!info] Title with alias`; `[!custom] T` → plain quote `> T`; fenced `dataview`, `dataviewjs`, `tasks`, `query`, `mermaid` → gone, ```` ```js ```` kept without its language; `<div>x</div>`, `<!-- c -->` → gone; `%%x%%` gone; unclosed `%%` drops the rest; footnote reference `[^1]` → nothing, definition gone; `$s$`, `$$…$$` gone; `para ^abc` → `para`; frontmatter gone.
- [ ] **Step 2: Write `notesLeak.test.ts`** in the family pattern (`seeded` from `tests/unit/online/gm/seeded.ts`, `TRIALS = 200`): each trial builds a random note from fragments (shared parts carrying public words, every hidden construct of the Global Constraints carrying a unique secret word: in `[!gm]` at random depth, comments, raw HTML, code with plugin languages, definitions, footnotes, math, link targets and paths of unshared notes, image file names, frontmatter values) nested at random inside lists, tables, quotes and callouts; asserts no secret word occurs in `markdown`, every public word does, and `parseNote(markdown)` of the copy contains only kept node kinds.
- [ ] **Step 3: Run** `npx vitest run --project unit tests/unit/online/gm/notes tests/unit/online/gm/notesLeak.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** per the interfaces.
- [ ] **Step 5: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "GM: build the player copy of a shared note by an allowlist"`.

### Task 4: Drop queued asset chunks by hash

**Files:**
- Modify: `src/app/online/gm/sendQueue.ts` (`QueuedFrame.tag`, `push` / `dropTagged`), `TableConnection.ts:152-160` (`send` passes a tag to every part; `dropTagged`), `assetAnswers.ts:7-12,104-108` (`AssetAnswerPorts.send` gains `tag?`, `serve` tags chunks), every `AssetAnswerPorts` construction that forwards `send` (grep `send: (body, to)` in `src/app/online/gm`)
- Test: `tests/unit/online/gm/sendQueue.test.ts` (or the existing `sendBatch.test.ts`), `tests/unit/online/gm/tableConnection.test.ts`, `tests/unit/online/gm/assetAnswers.test.ts`

**Interfaces:**
- Produces: `assetTag(hash: string): string` → `asset:<hash>` (in `assetServe.ts`); `SendQueue.push(frame: string, to?: string, entry?: string, tag?: string): void`; `SendQueue.dropTagged(tag: string): number` (removes every non-live frame with that tag, returns how many); `TableConnection.send(body: GmMessage, to?: string, tag?: string): void` (every `part` of a split message carries the tag); `TableConnection.dropTagged(tag: string): void`; `AssetAnswerPorts.send(body: GmMessage, to: string, tag?: string): void`, `AssetAnswers.serve` sends each chunk with `assetTag(hash)`.

- [ ] **Step 1: Write the failing tests:** a queue holding frames for two players tagged `asset:a`, `asset:b` and untagged → `dropTagged('asset:a')` leaves the others in order and returns the count; a 300 KiB-chunk text served through `AssetAnswers` + `TableConnection` with the socket held back (buffered over 64 KiB) → after `dropTagged(assetTag(hash))` no frame of that asset is sent when the socket drains, while a scene message queued between stays.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: drop an asset's queued chunks by hash"`.

### Task 5: NotesShare (shared set, list, serving, unsharing) and its wiring

**Files:**
- Create: `src/app/online/gm/notes/NotesShare.ts`, `src/app/online/gm/notes/sharedNotes.ts` (which notes are shared, ids, titles, groups; vault events), `src/app/online/gm/notes/tableNotes.ts` (factory)
- Modify: `src/app/online/gm/OnlineTable.ts` (construct through `tableNotes`, routing chain at :230 before `found`, `resend` :386, `left` :218, `stop`, `ForkClients` `onClient`), `forkClients.ts` if `onClient` needs a second listener
- Test: `tests/unit/online/gm/notes/notesShare.test.ts`, extend `tests/unit/online/gm/notesLeak.test.ts`

**Interfaces:**
- Consumes: `parseNote`, `copyForPlayers` (Tasks 2-3), `assetTag`, `TableConnection.dropTagged` (Task 4), `NOTES_LEVEL`, `NotesMessage` (Task 1), `QuestImages` (`src/app/plugin/questImages.ts`), `AssetAnswers`, `sha256Hex`, `TEXT_MIME_TYPE`.
- Produces: `interface NotesSharePorts { app: App; players(): readonly string[]; levelOf(player: string): number; send(body: GmMessage, to: string, tag?: string): void; dropTagged(tag: string): void; randomId(): string; now(): number; tickets?: AssetAnswerPorts['tickets']; images: QuestImages }`; `class NotesShare { constructor(ports: NotesSharePorts); start(): void; stop(): void; resend(to?: string): void; client(player: string): void; receive(from: string, body: PlayerMessage): boolean; playerLeft(player: string): void; get count(): number }`; `tableNotes(deps): NotesShare` builds the ports from the table's connection, ownership and fork levels.
- Behaviour: on `start` reads every Markdown file's frontmatter from the metadata cache and builds copies of the shared ones (in memory: id → {path, title, group, text ref, bytes, image hashes}); ids are `randomId()` per path for the table's lifetime and follow vault renames; listens to `metadataCache` `changed` and `deleted`, `vault` `rename` and `modify`/`create`/`delete` of images, and `resolved` (link targets may have changed), and rebuilds the affected copies plus every shared note that links to a note whose shared state changed. Concurrent rebuilds of one note: the last read wins (turn counter, as `FoundTexts`). After a rebuild: every text or image hash that left the set → `dropTagged(assetTag(hash))` and forgotten by `AssetAnswers`; the list is re-sent to level-3 players when it changed (compared as JSON). `receive` claims an `asset-request` only for hashes it holds (text → `PictureAssets.text`, image → `artPath`), returning false otherwise.

- [ ] **Step 1: Write the failing tests** (`questVault` mock from `tests/mocks/questVault.ts` with frontmatter, a fake connection recording `{body, to, tag}`): `lists only notes with atlas-share true` (`"true"` string not shared); `sends notes to level-3 players only` (levels 0, 2, 3); `sends the list after a client message`; `serves a shared note's text and its images`; `refuses hashes it does not hold` (returns false for others' hashes, `asset-refused` for its own old ones); `drops queued chunks when a note is edited to hide a passage` (request, then the file changes to wrap the passage in `[!gm]` → `dropTagged(asset:<old>)`, the new list has a new hash); `refuses the old hash after unsharing`; `follows renames and flag changes` (rename keeps the id and updates the title; a shared note linking `[[B|b]]` gets an in-app link once B is shared and plain `b` once it is unshared again); `never logs titles` (spy on `console.*` and the table log; titles, groups and paths never appear). `notesLeak.test.ts` gains a trial mode driving `NotesShare` through random edits, shares, unshares and renames, collecting every message and decoded chunk: no secret word of an unshared note or hidden part ever appears.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/online/gm/notes tests/unit/online/gm/notesLeak.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; `OnlineTable` gains only the field, the factory call and one line each in the router, `resend`, `left` and `stop`.
- [ ] **Step 4: Verify** the per-task checks and `npx vitest run --project unit tests/unit/online`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: share notes marked atlas-share with players"`.

### Task 6: GM settings text and dock row

**Files:**
- Create: `src/app/online/gm/dock/notesRow.ts`
- Modify: `src/app/online/gm/settings.ts` (a "Shared notes" section), dock wiring (`Dock.ts` / `panelModel.ts` snapshot gains `sharedNotes: number`), `src/app/i18n/locales/{en,zh}/onlineGm.ts` / `onlineDock.ts`, `docs/fork/zh-glossary.md`
- Test: `tests/unit/online/gm/settings.test.ts` (or the file testing `onlineSettingsSections`), `tests/unit/online/gm/dock/*.test.ts` beside the image row's test

**Interfaces:**
- Consumes: `NotesShare.count` (Task 5).
- Produces: settings section heading "Shared notes / 共享笔记" with one description row (exact en text): "A note is shared with players when its frontmatter has `atlas-share: true`; `atlas-share-group` sets the group players see. Players never see `[!gm]` callouts, `%%comments%%`, links to notes that are not shared, or file names. Headings and other conventions hide nothing." (zh translated per glossary); dock row "N notes shared / 已共享 N 篇笔记" (plural forms), plus "Only the first 500 notes are shared / 只共享前 500 篇笔记" when the cap was hit.

- [ ] **Step 1: Write the failing tests** for the section's text keys and the row's count and cap line.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "GM: explain note sharing in settings and show the count in the dock"`.

### Task 7: Player Notes panel and allowlist renderer

**Files:**
- Create: `apps/play/src/notes/parseCopy.ts`, `apps/play/src/notes/NoteMarkdown.tsx` (mdast → React), `apps/play/src/notes/NoteImage.tsx`, `apps/play/src/ui/NotesPanel.tsx`
- Modify: `apps/play/src/state/tableStore.ts` (`notes: readonly SharedNote[]`, case `notes`), `apps/play/src/ui/PanelDock.tsx` (tab `notes`, lazy panel), `apps/play/src/ui/panels.scss`, `src/app/i18n/locales/{en,zh}/onlinePlay.ts`, `scripts/boundaries.mjs` (`play.packages`)
- Test: `tests/unit/play/notesPanel.test.tsx`, `tests/unit/play/noteMarkdown.test.tsx`, `tests/unit/play/tableStore.test.ts`, `tests/unit/play/boundaries.test.ts` if it pins the package list

**Interfaces:**
- Consumes: `SharedNote`, `noteIdOf`, `assetImageOf`, `isHttpsUrl`, `calloutHead`, `CALLOUT_TYPES` (Task 1); `AssetLoader.load(ref, maxSide)`.
- Produces: `parseCopy(markdown: string): Root` (from-markdown + gfm only); `NoteMarkdown({ tree, notes, onOpen, assets }): ReactElement` rendering only: p, h1-h6, em, strong, del, code, pre>code (no class), ul/ol (`start`), li with a disabled checkbox for `checked`, table/thead/tbody/tr/th/td (`align` through a class, never `style`), hr, blockquote, callout (`div.atlas-play-callout` with a type class from `CALLOUT_TYPES` and the title as text), br; links: `isHttpsUrl` → `<a href target="_blank" rel="noopener noreferrer">`, `noteIdOf` of a listed note → a `<button>` calling `onOpen(id)`, anything else → its text; images: `assetImageOf` → `NoteImage` (object URL from `assets.load(ref, NOTE_IMAGE_SIDE)`, revoked on unmount, alt from the tree), anything else → nothing. Every other node kind renders nothing. No `dangerouslySetInnerHTML`, no `innerHTML`, no `style` or `on*` props from data. `NOTE_IMAGE_SIDE = 1280`.
- Panel: tab label "笔记 / Notes"; the list groups notes by `group` (ungrouped first, groups by `localeCompare`), titles sorted the same way; opening a note loads its text with `assets.load(note.text, null)`, decodes UTF-8 and renders it; back button returns to the list; a note that leaves the list while open closes with the line "这篇笔记已不再共享 / This note is no longer shared"; a failed load shows "笔记加载失败 / Could not load the note" with a retry. `NotesPanel` is loaded with `React.lazy(() => import('./NotesPanel'))` so the Markdown code is a separate chunk.

- [ ] **Step 1: Write the failing tests** (jsdom): `renders only allowed elements` — feed `parseCopy` Markdown containing `<script>`, `<img src=x onerror=…>`, `[a](javascript:…)`, `[b](http://x)`, `[c](data:text/html,…)`, `![d](https://x/y.png)`, `![e](data:image/png;base64,…)`, `[f](atlas-note:<unlisted id>)`, `[^1]`, a table with `align`; assert the DOM has no `script`, `iframe`, `img` other than the asset ones, no attribute starting with `on`, no `style` attribute, no `href` not starting with `https:`, and texts `a`, `b`, `c`, `f` shown as text; callout `> [!warning] Mind` renders the callout box with title `Mind`; `[!madeup]` renders a plain quote. `notesPanel.test.tsx`: grouped list order; open, render, back; an in-app link opens the other note; removal while open shows the line; failed load shows retry. `tableStore.test.ts`: `notes` message replaces the list; a reset/reconnect keeps it until the GM sends a new one.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play`. Expected: FAIL.
- [ ] **Step 3: Implement**; add the packages to `play.packages`.
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play` (the Notes chunk is separate: `apps/play/dist/assets` holds a chunk with micromark and the main chunk does not grow by more than 5 kB). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: notes panel with an allowlist Markdown renderer"`.

### Task 8: Notes end to end, browser check, docs

**Files:**
- Modify: `tests/unit/play/endToEnd.test.ts`, `tests/e2e/playPage.e2e.test.ts`, `docs/fork/online-contract.md`, `docs/fork/FORK_GUIDE.md` (notes paragraph), `docs/fork/online-followups.md`
- Test: the two test files

- [ ] **Step 1: Write the failing tests.** `endToEnd.test.ts` (real relay, real `OnlineControl`, real `Session`, vault mock): a note with `atlas-share: true` reaches the player's store in `notes`; the player loads its text over the relay and the SHA-256 matches; its image arrives by ticket; the GM unshares it → the list empties and a new request is refused. `playPage.e2e.test.ts` (Chromium, real CSP): open the Notes tab, open a note with a table, a callout and an image (blob URL), click an in-app link; no CSP violation in the console.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/endToEnd.test.ts` and `npm run test:play-e2e`. Expected: FAIL.
- [ ] **Step 3: Fix** wiring only (a defect in an earlier task's unit goes back to that unit with a test). Docs: contract (level 3, `notes`, note URLs, asset tags), FORK_GUIDE (how sharing works, where the parser lives), follow-ups (residuals).
- [ ] **Step 4: Verify** everything: per-task checks, `npm run build:play`, `npx vitest run --project unit`, `npm run test:play-e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "M5: shared notes end to end and docs"`.

### Task 9: Relay bundle, static caching and the deployment guide

**Files:**
- Create: `scripts/bundle-relay.mjs`, `apps/relay/deploy/atlas-relay.service` (template), `apps/relay/deploy/relay.env.example`, `scripts/relay-probe.mjs`, `docs/fork/deployment.md`
- Modify: `package.json` (`bundle:relay`, `probe:relay` scripts), `apps/relay/src/static.ts` (Cache-Control), `apps/relay/README.md` (link to the guide), `docs/fork/FORK_GUIDE.md` (commands)
- Test: `tests/unit/relay/static.test.ts` (extend), `tests/unit/relay/bundle.test.ts`

**Interfaces:**
- Produces: `npm run bundle:relay` → builds `apps/play`, then writes `dist/relay-bundle/` holding `apps/relay/src/**`, `apps/relay/package.json`, exactly the protocol files the relay imports (computed from the import graph, not a hand list), `apps/play/dist/**`, a root `package.json` `{ "private": true, "type": "module", "dependencies": { "ws": "8.18.3" } }` and `package-lock.json` for it, and a `VERSION` file with the git commit; then `dist/relay-bundle.tgz`. Started on the server with `node apps/relay/src/main.ts` from the bundle root after `npm ci --omit=dev`.
- Static caching: `index.html` (and `/`) → `Cache-Control: no-cache`; files under `assets/` (Vite's hashed names) → `public, max-age=31536000, immutable`; everything else `no-cache`.
- `atlas-relay.service`: `User=atlas-relay`, `WorkingDirectory=/opt/atlas-relay/current`, `EnvironmentFile=/etc/atlas-relay.env`, `ExecStart=/usr/bin/node apps/relay/src/main.ts`, `Restart=on-failure`, `KillSignal=SIGTERM`, `TimeoutStopSec=15`, hardening (`NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `ReadWritePaths=/var/lib/atlas-relay`, `MemoryMax=768M`). `relay.env.example`: `HOST_KEY=` (empty, with the `openssl rand -base64 32` hint), `PUBLIC_ORIGIN=https://play.example.com`, `HOST=127.0.0.1`, `PORT=8787`, `TRUST_PROXY=cf`, `STATE_PATH=/var/lib/atlas-relay/relay-state.json`, `ASSET_DIR=/var/lib/atlas-relay/assets`, `STATIC_DIR=apps/play/dist`.
- `npm run probe:relay -- <origin>` (host key from the env `HOST_KEY`, never an argument, never printed): creates a table, joins one player, sends a 320 KiB GM frame and checks it arrives whole, waits 110 s idle and checks both sockets are still open, uploads one 8 MiB part and completes it, ends the table; prints one line per check, pass or fail.
- `docs/fork/deployment.md`: the 6.5 checklist (WebSocket `Upgrade`/`Connection` through the proxy, forwarded-address header and `TRUST_PROXY`, request body ≥ 9 MiB, frames of 512 KiB, TLS renewal (Cloudflare's edge certificate here; Caddy/nginx for a direct setup), restarting proxy and relay together, a phone on mobile data), the Hetzner + Cloudflare Tunnel recipe, the generic reverse-proxy recipe, how to update (new bundle into `/opt/atlas-relay/releases/<commit>`, switch the `current` symlink, restart), how to back up the state file (mode 0600), and a results section filled by Tasks 11-12.

- [ ] **Step 1: Write the failing tests:** static headers per path; `bundle.test.ts` runs the bundler into a temp dir and asserts the file set (relay sources, the six protocol files `relay.ts`, `identity.ts`, `level.ts`, `seat.ts`, `shape.ts`, `asset.ts` and nothing else from `src/`, `apps/play/dist/index.html`), then starts the relay from the bundle with a temp state path and `GET /` answers `200` with `index.html`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/relay`. Expected: FAIL.
- [ ] **Step 3: Implement**; the probe is checked by hand against a local relay (`HOST_KEY=… npm run relay` then `npm run probe:relay -- http://127.0.0.1:8787`; its idle check passes trivially locally).
- [ ] **Step 4: Verify** the per-task checks. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Relay: deploy bundle, static caching, probe and deployment guide"`.

### Task 10: Player app ready for phones (wake and network reconnect)

**Files:**
- Modify: `apps/play/src/net/TableSocket.ts` (open timeout, `wake()`), `apps/play/src/app/session.ts` (listen to `visibilitychange` and `online`, release on stop), `docs/fork/online-followups.md` (strike the two items)
- Test: `tests/unit/play/tableSocket.test.ts`, `tests/unit/play/session.test.ts`

**Interfaces:**
- Produces: `OPEN_TIMEOUT_MS = 10_000` — a socket not open (no first frame) within it is torn down and retried; `TableSocket.wake(): void` — when the socket is not open, cancel the backoff timer and retry now; when open, send a keep-alive ping and arm the dead timer at once (a socket that died while the phone slept is noticed in `DEAD_AFTER_MS` rather than at the next ping). The session calls `wake()` on `visibilitychange` to visible and on `online`.

- [ ] **Step 1: Write the failing tests:** a socket that never opens is retried after 10 s; `reconnects when the page becomes visible` — during a 30 s backoff, `wake()` connects at once; `wake()` on an open socket sends a ping and a socket that answers nothing within `DEAD_AFTER_MS` is replaced; the session's listeners are removed on stop.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/play/tableSocket.test.ts tests/unit/play/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the per-task checks and `npm run build:play`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Play: reconnect promptly when a phone wakes or its network returns"`.

### Task 11: Deploy to the VPS (controller task, each VPS step after the user's go-ahead)

Not for a subagent: it touches the live server and Cloudflare. The controller runs it, shows the user each command group before running it, and never prints a secret.

- [ ] **Step 1: Inspect, read only** (via `~/Developer/vps-setup/vps-ssh.sh`): `node -v`, `systemctl status cloudflared`, how the `abs` tunnel is managed (`/etc/cloudflared/config.yml` present, or a `--token` in the unit = dashboard-managed), `ss -ltnp | grep 8787`, free disk and memory. Report to the user.
- [ ] **Step 2: Node 22** (after go-ahead): install Node 22 LTS from NodeSource's apt repository (pinned major 22), unless a Node >= 22.18 is already there; nothing else on the box uses Node from apt (check first).
- [ ] **Step 3: Service** (after go-ahead): user `atlas-relay` (system, no shell), `/opt/atlas-relay/releases/<commit>` from `npm run bundle:relay` (scp the tgz, `npm ci --omit=dev`), `current` symlink, `/var/lib/atlas-relay` (0700), `/etc/atlas-relay.env` (0600, root) from the example. The host key is generated locally with `openssl rand -base64 32` straight into `~/Developer/vps-setup/.env` as `ATLAS_HOST_KEY` and copied to the server file over ssh stdin, never echoed. Install the unit, `systemctl enable --now atlas-relay`, check `curl -sI http://127.0.0.1:8787/` on the box.
- [ ] **Step 4: Tunnel** (after go-ahead): locally managed → add `- hostname: play.xinsawi.com` / `service: http://127.0.0.1:8787` above the catch-all in the config, `cloudflared tunnel route dns abs play.xinsawi.com`, `cloudflared tunnel ingress validate`, restart cloudflared, and check `pod.xinsawi.com` still answers; dashboard-managed → give the user the exact public-hostname entry to add in Zero Trust and wait. Cloudflare settings for the hostname: WebSockets on (zone setting), no caching rule needed (the headers decide).
- [ ] **Step 5: Probe:** `HOST_KEY` from `~/Developer/vps-setup/.env` into the probe's environment without printing it; `npm run probe:relay -- https://play.xinsawi.com`. All checks pass, or the failure is diagnosed and recorded. Record results (date, Node version, bundle commit, probe lines) in `docs/fork/deployment.md` and the box's notes in `~/Developer/vps-setup/vps-info.md` (service, paths, hostname; no secrets).
- [ ] **Step 6: Commit** `git commit -m "Docs: production relay on the Hetzner VPS"` (repo docs only).

### Task 12: Test game on phones (with the user)

- [ ] **Step 1:** The user sets the plugin's server address to `https://play.xinsawi.com` and pastes the host key (from `~/Developer/vps-setup/.env`, read by the user, not by the agent), starts a table, shares a test note.
- [ ] **Step 2:** On at least one phone on mainland mobile data (and one on Wi-Fi), players join by link, see the map and a lit scene, move their token, roll dice, read the shared note with its image, and survive locking the phone for two minutes. The checks still open in `docs/fork/online-followups.md` (iOS Safari CSP `ws:` matching, touch `lostpointercapture`, square-grid snap offset, banner contrast) are checked at the same time.
- [ ] **Step 3:** Record what worked, load times and failures in `docs/fork/deployment.md`; open items go to `online-followups.md`. If mainland reachability is unusable, record it and stop: the fallbacks (Cloudflare settings, a Hong Kong relay, a direct origin) are a decision for the user, not part of this plan.
- [ ] **Step 4: Commit** `git commit -m "Docs: results of the M6 phone test"`.

## Rulings in this plan (spec gaps)

- Libraries: micromark/mdast (unified ecosystem, maintained, ESM, no Node APIs) over markdown-it: mdast keeps reference links, definitions, footnotes, math, frontmatter and raw HTML as distinct node kinds, which the allowlist needs to tell apart; markdown-it resolves reference links into ordinary links and has no math or frontmatter without more plugins. Wikilinks and `%%comments%%` are a small micromark extension of our own, not a third-party plugin.
- The player renders the mdast straight into React elements with an element allowlist instead of producing HTML and sanitising it: no HTML string exists, so there is nothing for a sanitiser to miss and no DOMPurify dependency. This meets 6.4's "raw HTML disabled, then sanitise with an allowlist" by construction.
- The `notes` entries carry the text's `AssetRef` (hash, size, MIME) beside id, title and group; the player needs it to request the text. The hash reveals nothing beyond the copy.
- In-app links and note images travel inside the Markdown as `atlas-note:<id>` and `atlas-asset:<hash>?size=&mime=` URLs.
- An unaliased wikilink to a note that is not shared is dropped entirely: its only visible text is the typed target, which 6.4 forbids sending. A shared target's unaliased link shows the target's title (already in the list).
- Code blocks are kept by an allowlist of plain languages (`PLAIN_CODE_LANGUAGES`) rather than a list of plugin languages, and the language is not sent. `mermaid` is dropped.
- Remote images are dropped (the player page's CSP blocks them anyway, and they would let a third party see who reads the note).
- When a note changes, the old text hash and any image no longer referenced are treated like an unshared note (queued chunks dropped, requests refused), so a passage the GM hides mid-game stops leaving at once.
- Note ids are random per table session; a GM reload gives new ids and the players' panel refreshes from the new list.
- Spec 6.5 amended 2026-10-28 (user decision): production is the Hetzner VPS behind the existing Cloudflare Tunnel, not Alibaba Cloud; the Alibaba path stays documented as the fallback the user may choose after the phone test.
- Two phone-readiness follow-ups (open timeout, reconnect on wake) are done in M6 because the M6 test game is on phones; the main-chunk split stays a follow-up (the Notes code is split off instead).
