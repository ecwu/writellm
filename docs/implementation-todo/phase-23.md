# Phase 23: Agent Table Authoring And Publication

Status: Checkpoint 74 is complete under ADR 066.
Recorded: 2026-08-28

## Checkpoint 74

- [x] Register Protocol v11, table coordinate semantics, portable-table limits, and publication
  loss boundaries under ADR 066.
- [x] Add pure table normalization, occupancy, transformation, and diff coverage.
- [x] Add paged table reads plus typed insert/edit proposal operations and stale-hash protection.
- [x] Add bounded table proposal review and explicit native editor table options.
- [x] Advance publication assembly to v2 and complete Markdown, PDF, and LaTeX table projections.
- [x] Pass focused, `pnpm check`, `pnpm check:electron`, fresh `pnpm check:e2e`, and no-identity
  `pnpm check:package` gates without running `check:release`.

## Scope boundary

No dependency, SQLite migration, worker role, durable job, IPC authority, editor replacement,
external converter, TeX compiler, merge/split authority, table captions, numbering, cross-
references, colors, nested block-cell content, or lossless LaTeX rowspan is authorized.

## Local evidence

- ADR 066 records Protocol v11, zero-based hash-bound occupancy coordinates, span fail-closed
  behavior, portable-table limits, publication assembly v2, and the explicit lossy boundaries.
- The shared transformer normalizes cells, validates rectangular occupancy and spans, applies
  ordered typed edits without mutating input, preserves historical span anchors, and produces a
  bounded deterministic table summary. Complete cells include explicit unit spans so a BlockNote
  open/save round trip cannot invalidate the next hash-bound Agent edit. Shared contracts and
  provider JSON Schema cover rich inline cells, limits, safe links, inline math, and strict
  unknown-field rejection.
- Main pages `read_section(view: "table")`, binds edits to the complete table-block hash and the
  current Agent run, creates native block IDs, simulates typed operations through the existing
  section patch, derives `table_diff`, and retains the one-revision proposal/apply/undo path.
- The Renderer enables BlockNote headers while disabling split and color controls, and renders the
  derived diff with the existing shadcn table and proposal semantics in a bounded overflow region.
- Publication assembly v2 preserves header columns, alignment, widths, and spans. Markdown emits
  GFM alignment and explicit loss records; PDF emits semantic paged HTML tables; inert LaTeX emits
  aligned `longtable` columns, repeated headers, colspan, and explicit rowspan fallback. Existing
  DOCX table coverage remains green.
- Focused verification passed 98 shared/Main/Renderer tests plus 26 publication tests, the 31-test
  transformer/Main regression slice, and the dedicated real-Electron table scenario. `pnpm check`
  passed 652 files. `pnpm check:electron` passed 201 test files / 1,152 tests with three intentional
  benchmark skips and the production build. Fresh `pnpm check:e2e` passed 47/47 with no flaky or
  skipped scenario.
- `pnpm check:package` passed all 27 recovery fixtures from 25 sources, all 12 packaged smoke
  scenarios, 34/34 packaged E2E scenarios, the arm64 native/ASAR/resource inventory, and DMG/ZIP
  structural inspection. It produced local unsigned artifacts only; `check:release`, commit, tag,
  push, hosted CI, signing, notarization, promotion, and publication did not run.
