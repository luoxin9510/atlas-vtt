# Fork guide for coding agents

This is `luoxin9510/atlas-vtt`, a personal learning fork of
[ByteMirror/atlas-vtt](https://github.com/ByteMirror/atlas-vtt) (AGPL-3.0-only).
It is loaded into every Claude Code session through `CLAUDE.local.md`.

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
- Never change `manifest.json`, `versions.json` or plugin ids.
- Fork documentation is English and lives under `docs/fork/`.
- Commit at the end of each phase with a clear message. Never push unless the
  user asks.
- Work in the phases the user defines. At the end of a phase: stop, summarize
  what was done and found, and wait for confirmation.
- Report failures with their root cause. Change source code to make a check
  pass only when the fix is trivial and environment-related; otherwise ask.

## Branches and remotes

- `origin` = the fork, `upstream` = ByteMirror/atlas-vtt.
- `main` mirrors `upstream/main` (stable releases) and carries no fork commits.
- Fork work happens on `fork/work`, branched from `main`.
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

Environment variables and the reverse proxy note are in `apps/relay/README.md`.

- `npm run test:gpu` runs browser tests locally only.
- A unit test needing a DOM starts with `// @vitest-environment jsdom`.

## Dev vault

`./dev-vault` (gitignored) is the development vault. The copy target is
resolved by `scripts/worktree-targets.js`: it copies into a vault only when
its `.obsidian` folder already exists, and it reads extra vaults from
`ATLAS_DEV_VAULTS`. `.envrc` (direnv, gitignored) exports
`ATLAS_DEV_VAULTS="$PWD/dev-vault"`, so `npm run dev` and `npm run build`
copy `main.js`, `styles.css` and `manifest.json` into
`dev-vault/.obsidian/plugins/atlas-vtt/`. Without direnv, prefix the command:
`ATLAS_DEV_VAULTS="$PWD/dev-vault" npm run dev`. Open `dev-vault` as a vault
in Obsidian and enable community plugins once.

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

Give subagents self-contained prompts (paths, rules from this guide, the exact
output format) and ask for conclusions with `file:line` references, not raw
file dumps. Spot-check their findings before reporting them.

## Working with the user

- The user writes Chinese; answer in Chinese. Code, commits and fork docs are
  English.
- Fork documents so far: `ARCHITECTURE.md`, `i18n-zh-gap.md`,
  `zh-glossary.md`, `atlasmap-format.md`, `atlasmap.schema.json`
  (added phase by phase).
