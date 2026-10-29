# Fork guide for coding agents

This is `luoxin9510/atlas-vtt`, a personal learning fork of
[ByteMirror/atlas-vtt](https://github.com/ByteMirror/atlas-vtt) (AGPL-3.0-only).
It is loaded into every Claude Code session through `CLAUDE.local.md`.

> **Reply to the user in Chinese (简体中文), always**, including progress notes,
> questions and final reports. Code, identifiers, commits, PR text and fork docs stay English.

The upstream `CLAUDE.md` (about 230 KB) is **excluded from automatic loading**
(`claudeMdExcludes` in `.claude/settings.local.json`) because it would fill a
large part of the context in every session. It is still the authority on how
the code works. Before changing code in an area, read its section:

```sh
grep -n '^#\{1,2\} ' CLAUDE.md          # list the sections and their lines
```

| Area you touch | Upstream `CLAUDE.md` section |
| --- | --- |
| Any code | `Coding pattern preferences`, `Context` |
| Styles, panels, toolbar, tooltips | `UI Design Principles` |
| Vault files, collections, the asset index | `Vault files and the asset index` |
| Scene / token file fields on disk | `Token resources` (file format bullets), `Map images`, `Dynamic lighting` |
| Grids, coordinates, map stretch | `Hexagonal Grids`, `Cell Numbering` |
| System presets | `Game system presets` |
| UI text and locales | `Translations` |
| Notes linking to scenes | `Links to Atlas files in notes` |
| Undo history, teardown, loading | `Undo/Redo History`, `Rendering and teardown`, `Loading and skeletons` |

## Fork rules (never break these)

- Never remove or alter license headers, `LICENSE`, `THIRD_PARTY_NOTICES.md`,
  `CLA.md` or attributions.
- `src/app/online/`, `apps/` and the online protocol are fork-owned: no upstream
  merges there, and conflicts resolve to the fork (spec 6.6).
- Never change `manifest.json` or `versions.json`; the repository's plugin id stays
  `atlas-vtt` (local installs use `atlas-vtt-fork`, see Dev vault). Code that looks Atlas
  up in the plugin registry or the command list uses `atlasPluginId()` /
  `atlasCommandId()` (`src/app/plugin/pluginId.ts`), never the literal id.
- Fork documentation is English and lives under `docs/fork/`.
- Never push to `upstream`, never open PRs against ByteMirror, never commit to `main`.
- Report failures with their root cause. Change source code to make a check
  pass only when the fix is trivial and environment-related; otherwise ask.
- Ask before touching the VPS or Cloudflare (deploys included), and never print or
  copy secrets (`~/Developer/vps-setup/.env`, host keys, tickets, table secrets).

## How work is done

- Larger work goes design → plan → execution: specs in `docs/superpowers/specs/`, plans in
  `docs/superpowers/plans/`, executed task by task (subagent per task, a review per task, a
  final whole-branch review). Ledgers live in `.superpowers/sdd/<plan>/` (gitignored).
- Each plan runs on a `feature/*` branch with one commit per task. When a plan is done and the
  full gate is green, push the branch and open a PR into `fork/work` (stack on the previous
  feature branch while its PR is open). Merging is the user's decision.
- The full gate: `npx tsc --noEmit`, `npm run lint`, `npm run check:play`, `npm run check:relay`,
  `npm run check:boundaries`, `npx vitest run --project unit`.
- Open follow-ups are tracked in `docs/fork/online-followups.md`; strike items when done.

## Branches and remotes

- `origin` = the fork, `upstream` = ByteMirror/atlas-vtt.
- `main` mirrors `upstream/main` (stable releases) and carries no fork commits.
- Fork work happens on `fork/work`, branched from `main`; features arrive there through
  PRs from `feature/*` branches.
- Upstream develops on `beta`; `main` only receives promotions. To sync:
  `git fetch upstream && git switch main && git merge --ff-only upstream/main`,
  then rebase or merge `fork/work` onto it.

## Commands

Node >= 22 (`.nvmrc`: 22). The checks CI blocks on:

```sh
npm ci
npx tsc --noEmit          # type check
npm run lint              # eslint-plugin-obsidianmd, zero warnings
npm test                  # vitest unit project (watch mode; use `npx vitest run --project unit` for one run)
npm run build             # vite build, then scripts/copy-plugin.js
```

The self-hosted relay is the `apps/relay` npm workspace (Node >= 22.18, runs
TypeScript natively): `npm run relay` starts it, `npm run check:relay` type
checks it. ESLint ignores `apps/`.

```sh
HOST_KEY=... PUBLIC_ORIGIN=https://play.example.com npm run relay   # run the relay
npm run check:relay                                                # type check it
npx vitest run --project unit tests/unit/relay                     # its tests
```

The player web app is the `apps/play` workspace (`@atlas-fork/play`, React + Pixi):

```sh
npm run dev:play     # vite dev server, proxies /api to PLAY_RELAY (default http://127.0.0.1:8787)
npm run build:play   # builds apps/play/dist, the relay's STATIC_DIR
npm run check:play   # type check it; imports are limited by the `play` group (npm run check:boundaries)
npx vitest run --project unit tests/unit/play
npm run test:play-e2e   # builds apps/play, then a real Chromium against the relay (project `play-e2e`, not part of `unit`)
```

```sh
npm run bundle:relay                                  # dist/relay-bundle(.tgz): relay + protocol files + player build
HOST_KEY=... npm run probe:relay -- https://play.example.com   # remote checks (--quick skips the 110 s idle wait)
```

`probe:relay` refuses a plain `http:` address that is not loopback (`localhost`, `[::1]`, `127.x.x.x`) unless `--insecure` is given, because the host key would travel in clear text.

Environment variables and the reverse proxy note are in `apps/relay/README.md`; deploying is in `docs/fork/deployment.md`.

The relay also keeps the GM's map and token images (`ASSET_DIR`, 2 GiB per table, 10 GiB per
server, uploads refused with 507 under 2 GiB of free disk) and hands players short-lived download
tickets; the wire format is in `docs/fork/online-contract.md` section 4. `npm run test:play-e2e`
needs Chromium from Playwright (`npx playwright install chromium`) and runs the lit scene on
software GL (swiftshader), so allow a minute or two. Tests that need a GPU:
`npm run test:gpu -- tests/gpu/play*`.

- `npm run test:gpu` runs browser tests locally only.
- A unit test needing a DOM starts with `// @vitest-environment jsdom`.

## Dev vault

`./dev-vault` (gitignored) is the development vault. The copy target is
resolved by `scripts/worktree-targets.js`: it copies into a vault only when
its `.obsidian` folder already exists, and it reads extra vaults from
`ATLAS_DEV_VAULTS`. `.envrc` (direnv, gitignored) exports
`ATLAS_DEV_VAULTS="$PWD/dev-vault"`, so `npm run dev` and `npm run build`
copy `main.js`, `styles.css` and `manifest.json` into
`dev-vault/.obsidian/plugins/atlas-vtt-fork/`. Without direnv, prefix the command:
`ATLAS_DEV_VAULTS="$PWD/dev-vault" npm run dev`. Open `dev-vault` as a vault
in Obsidian and enable community plugins once.

Local installs carry the id `atlas-vtt-fork` (name "Atlas VTT (fork)", version
`<version>-fork`). `scripts/copy-plugin.js` writes that manifest through
`scripts/forkManifest.js`; the repository's `manifest.json` keeps `atlas-vtt`
and is never changed, so upstream merges stay clean. The reason: the community
store would "update" a plugin installed as `atlas-vtt` to the official
release, replacing this fork. Never enable both plugins in one vault.

A new id starts with a fresh `data.json`: Atlas settings from an old `atlas-vtt` folder are not
carried over (copy `data.json` across by hand when switching a vault).

The `-fork` version suffix turns off the upstream update notice and the changelog's release matching (`releaseBaseVersion('0.9.1-fork')` is null); this is intended.

Online play is an **experimental feature, off by default**: switch it on in the Atlas command
palette's Experimental features page (setting `experimental.onlinePlay`); dynamic lighting is
`experimental.dynamicLighting`. Its settings sections ("联机服务器", "共享笔记", "联机诊断") appear
only while it is on. On Obsidian 1.13+ the settings tab caches its definitions, so a change of
sections must call `AtlasSettingTab.refresh()` (wired through `onSectionsChanged`).

Testing inside Obsidian: the `obsidian` CLI drives a registered vault, for example
`obsidian vault=dev-vault plugin:reload id=atlas-vtt-fork`, `obsidian vault=dev-vault eval code="…"`,
`obsidian vault=dev-vault dev:errors`. `dev:screenshot` does not capture the Pixi map background.

## Conventions distilled from upstream (summary, not a replacement)

- PIXI.js **v8** imports only; Obsidian bundles v7 globally. Check current
  PixiJS v8 practice before changing Pixi code.
- Explicit return types on every TypeScript function. Files stay under about
  300 lines. Single responsibility; reuse existing code before adding new.
- No inline `eslint-disable`, no `@ts-ignore` / `@ts-expect-error`; fix the
  cause. Never run `eslint --fix` across the tree.
- Styles: SCSS with Obsidian CSS variables (`obsidian-colors.md`); no new
  Tailwind. Never set a `title` attribute; use `LabelTooltip`.
- Mock data only in tests; no stubs or fake data in product code.
- UI text: `t('file.key', values)` from `src/app/i18n/`. English
  (`locales/en/`) holds every key; other languages mirror its files and fall
  back to English per key. A key's first segment names its file. Keep
  `{placeholders}` and plural objects (`{ one, few, many, other }`) intact.
  Never concatenate translated fragments; join lists with `formatList`. Keys,
  ids, stored data, game system presets, issue reports and log messages stay
  English.
- Scene files: `ATLAS_VERSION` stays 4; token state reaches disk only through
  `tokenToFile` / `sceneToFile` and is read through `tokenFromFile` /
  `sceneFromFile`.

## Model routing (save the expensive model)

The user's plan makes the main model (Opus) the scarce resource. Delegate
mechanical work to subagents and keep judgment in the main session:

| Work | Model |
| --- | --- |
| Run checks and report (`npm ci`, build, test, lint, git), grep and summarize, inventories (missing keys, hard-coded strings, file lists), mechanical bulk edits | `haiku` |
| Work that needs to understand code: architecture drafts, tracing types and read/write paths, schema drafts, first-pass translations | `sonnet` |
| Decisions, user communication, reviewing subagent output, key edits | main session |
| Final whole-branch review of a plan | `opus` |

Give subagents self-contained prompts (paths, rules from this guide, the exact
output format) and ask for conclusions with `file:line` references, not raw
file dumps. Spot-check their findings before reporting them.

## Shared notes

A vault note is shared with players when its frontmatter has `atlas-share: true` (exactly the boolean;
`"true"`, `yes` and `1` do not count). `atlas-share-group` (a string) sets the group the player app shows;
the title is the file name. Where things live: the parser and the player copy are `src/app/online/gm/notes/`
(`parseNote.ts` reads Obsidian Markdown through an allowlist; `playerCopy.ts`, `copyText.ts`, `copyLinks.ts`
and `copyCallouts.ts` build the copy players get), `NotesShare.ts` keeps the shared set, the texts and images,
and serves them (built in `OnlineTable` by `tableNotes`), `notesWatch.ts` follows the vault. The wire format is
protocol level 3 (`src/app/online/protocol/fork.ts`, `noteLinks.ts`); the renderer is `apps/play/src/ui/NotesPanel.tsx`
with `apps/play/src/notes/`. The anti-goal is that nothing the GM hides reaches a player (`[!gm]` callouts,
`%%comments%%`, HTML, frontmatter, unshared notes, file names); `tests/unit/online/gm/notes/` holds the leak
tests, `tests/unit/play/endToEnd.test.ts` runs a note from the vault to the player's store through the real
relay, and `tests/e2e/playPage.e2e.test.ts` opens one in Chromium under the CSP. Any change to the copy
rules must keep those green.

## Working with the user

- The user writes Chinese; **always reply in Chinese**. Code, commits and fork docs are English.
- Fork documents (`docs/fork/`):
  - `ARCHITECTURE.md`: architecture overview.
  - `zh-glossary.md`, `i18n-zh-gap.md`: the Chinese localization.
  - `atlasmap-format.md`, `atlasmap.schema.json`, `schema/` and `examples/`: the scene file format.
  - `online-contract.md`: the wire protocol and relay contract.
  - `online-strings.md`: the online UI text inventory.
  - `online-followups.md`: open and finished follow-ups.
  - `deployment.md`: deploying, updating and probing the relay.
  - `research/`: background notes.
- The design is `docs/superpowers/specs/2026-10-26-self-hosted-online-design.md`.
