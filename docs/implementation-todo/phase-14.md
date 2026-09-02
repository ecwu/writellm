# WriteLLM Phase 14 Implementation Plan

Status: Checkpoint 65 is complete.
Recorded: 2026-08-23

## Checkpoint 65: Native Inline Mathematics

Decision: user-authorized implementation under ADR 057. Introduce BlockNote's native inline Math
only, preserve application-owned display Math and Mermaid, and keep SQLite revision JSON plus the
application publication projection authoritative.

- [x] Add the exact-pinned inline Math spec, bounded editing, slash-menu entry, and layout safety.
- [x] Advance section content to schema v4 with a forward-only current-revision migration.
- [x] Exclude formula source from counts, search, replacement, and readable-citation matching while
  exposing bounded `$...$` notation to Agent reads.
- [x] Map inline Math through Markdown and LaTeX import and Markdown, DOCX, PDF, and LaTeX output.
- [x] Verify contracts, migration integrity, editor behavior, hostile input, and full project gates.

Local evidence:

- Exact-pinned `@blocknote/math-block@0.54.0` installs from the frozen lockfile. Both production
  and complete dependency audits report zero known advisories.
- Shared/Main/Renderer coverage passed 18 focused files / 112 tests for v1-v4 contracts, 8 KiB
  bounds, canonical display/inline Math coexistence, migration 0037, search/replacement/counting,
  Agent reads and mutations, Markdown/LaTeX import, Markdown/DOCX/PDF/LaTeX publication, and
  hostile KaTeX input.
- Migration recovery passed all 26 cases from 24 sources, including the v36-to-v37 fixture,
  foreign-key/integrity checks, unchanged history, copied resource relations, and v4 current heads.
- `pnpm check`, `pnpm check:fast`, and `pnpm check:electron` passed. The complete Electron-hosted
  gate reported 198 passing files / 1097 passing tests plus three intentional benchmark skips and
  completed a production build.
- The native Inline Math Real-Electron scenario covers both delimiter input rules, Slash insertion,
  the source popup, keyboard commit/exit, invalid-source recovery, undo/redo, autosave/reopen,
  search isolation, hostile links, and light/dark rendering. The LaTeX import
  scenario verifies native inline Math before and after reopen.
- The fresh-build full Real-Electron manifest passed 44/44 scenarios serially with no flaky,
  skipped, or failed result. Two preceding default-parallel runs each exposed a different unrelated
  legacy resource/startup race after all Checkpoint 65 scenarios passed; each affected legacy
  scenario passed immediately in isolation before the deterministic full-manifest run.
- `git diff --check` passed. No native display Math, native Diagram, syntax-highlighting package,
  ODT/email export, BlockNote XL publication, package/release action, hosted CI, commit, push,
  signing, notarization, promotion, or publication was introduced or run.
