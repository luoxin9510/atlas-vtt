# Plan: character importers (P3c)

Spec: `docs/superpowers/specs/2026-11-27-rule-pack-api-design.md` (decisions 6, 13-15, 25-34). Branch
`feature/importers` from `fork/work`, one commit per task, each test-first (`tdd`). Full gate as in
P3b. Then `code-review`, an independent fresh-context review, `pr`, and the agent merges.

Rules: explicit return types; files under ~300 lines; no eslint-disable/ts-ignore; UI text via `t()`
(en + zh, glossary); no commercial game names; nothing changes for users without an importer.

## Task 1 — importer registry and import record

`registerImporter` / `importerIds` on `plugin.rulePacks` (registry built on `ruleRegistry`-style
per-id stack; no `builtin:`; dispose clears). `ImportedCharacter { name, templateId, values,
portrait?: { bytes } }`. The import record in the note's frontmatter (importer id, source path,
imported values' keys) with read/write helpers. d.ts + sync test.

## Task 2 — reading character files

A picker for several files that yields `{ path, bytes, fileName }` (Electron `webUtils`, node `fs`
read by path); `readSource(path)` for re-import, null when missing; missing → picker (decision 25).
Behind one small module so tests stub it.

## Task 3 — import flow

Command "Import character file…" (only while an importer is registered): pick files → choose the
collection (default: the open map's) → per file: importer by extension, `parse`, portrait sniffed
(PNG/JPG/WebP else none, decision 26) and written, note in the collection's `characters/` folder,
token asset in its library, linked; same source → ask then re-import (decision 27); summary
(decision 32).

## Task 4 — re-import

Diff of imported fields against the note (changed / added / removed, decisions 28-29), confirmation
modal, write only imported keys, keep the note's template (30), body, token conditions, and resource
current values clamped to the new maximum (15); portrait swap (31).

## Task 5 — where re-import lives (decision 33)

Note more-options menu, placed token context menu, command palette; only for notes with a record.

## Task 6 — docs and gate

CLAUDE.md, ARCHITECTURE.md, rule-pack-api.md/.d.ts, zh glossary; full gate; reviews; PR; merge.
Afterwards (local, not in this PR): G2 — atlas-gurps registers a GCS importer.
