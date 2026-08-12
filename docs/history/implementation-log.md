# Implementation History

Completed checkpoint details remain in the Phase files under
`docs/implementation-todo/`. This chronology records cross-phase transitions and documentation
maintenance without turning the active tracker back into a historical log.

## 2026-07-16

- Started Checkpoint 19.5 to converge Checkpoint 11–19 implementation with
  the accepted architecture amendment and complexity-reduction audit.
- Completed Checkpoint 19.5 convergence. The implementation now has ephemeral
  MinerU capabilities, seven durable job types, frozen Agent boundaries,
  classified revision retention, three worker roles, one atomic file writer,
  and 1536D 10k/50k/100k sqlite-vec benchmark evidence.
- Completed Checkpoint 19.5 audit remediation. Production artifact cleanup is
  durable and restart-recoverable; paused jobs migrate into the strict schema;
  direct Agent-parent revisions are retained; worker roles remain persistent;
  MinerU snapshot tests cover schema and values; and the real 1536D benchmark
  proves ten-file generation-build debounce with one persisted rebuild request.
  Electron-hosted Vitest passes 65 files/292 tests, the complete Electron E2E
  suite passes 9/9, the production build passes, Biome has only the existing
  shadcn sidebar cookie warning, and `git diff --check` passes. Checkpoint 20
  remains not started pending user approval.
- Completed a source-level implementation audit of Checkpoints 1–19 against the
  amended architecture. The functional bodies match their records. Gaps and
  rule violations are fixed into Checkpoints 19.6 (recovery exits, snapshot
  entry point, ALS correlation, worker log aggregation) and 19.7 (error
  swallowing, revision-source clamping, export logging, URL/CSP hardening,
  depth cap, worker session envelopes, abort propagation, retention, test
  backfill) in `docs/implementation-todo.md`; documentation overclaims were
  corrected in place, recent-project pointers are physically pruned to five,
  and the three superseded one-shot worker entry files were removed. Neither
  checkpoint has started; both require the user's approval, and Checkpoint 20
  remains deferred behind them.

## 2026-07-17

- Completed the approved Checkpoint 19.6/19.7 remediation and final gate. The
  C2 backfill covers the import progress/cancel/retry/delete/open/reveal flow,
  MinerU cancellation races, reverse and concurrent normalization completion,
  terminal parse failure, direct IndexClient stale/unmatched responses,
  parse/index activation races, and packaged provider-failure/stale-session
  scenarios. The current sidebar project assertion is shared by the writing
  workspace and project lifecycle E2E helpers.
- Added a post-build source-fingerprint recheck so a superseded index
  generation is never activated, and fixed the packaged smoke harness to
  create its project parent and wait for a real hybrid evidence hit instead of
  treating an earlier empty-index job as readiness.
- Final evidence: local Biome check (one existing shadcn cookie warning), Node
  and web TypeScript, Electron-hosted Vitest 70 files/322 tests, production
  `electron-vite build`, full Electron Playwright E2E 11/11, unpacked
  electron-builder packaging, packaged sqlite-vec/provider-fallback/stale-
  session smoke, and runtime app.sqlite inspection (application_id 1464615248,
  user_version 1, valid schema_manifest). The pnpm wrapper was unavailable
  because Corepack rejected the pnpm 11 registry signature; equivalent local
  commands passed. Checkpoint 20 remains not started.

## 2026-08-06

- Reduced `current-plan.md` to the active Checkpoint 26.9 state, its completed baseline, next
  authorized work, and deferred scope. Reduced `implementation-todo.md` to the active gate and a
  routing index for Phase evidence. Corrected stale Checkpoint 24 wording in `architecture.md`.
  No architecture decision, product boundary, or checkpoint scope changed.

## 2026-08-09

- Locally completed the authorized Checkpoint 27 Electron E2E evolution while leaving Checkpoint
  26.9 blocked. The suite now uses isolated per-test projects, stable manifest-backed scenario IDs,
  critical and packaged tiers, two workers, strict renderer error handling, keyboard/focus and
  axe-core accessibility coverage, and versioned fail-closed packaged evidence. The pull-request
  workflow includes an Ubuntu critical gate while the tagged workflow retains complete
  cross-platform coverage.
- Local verification passed `check:fast`; 115 Electron-hosted Vitest files with 583 passing tests
  and one opt-in benchmark skipped; 20/20 full Electron E2E scenarios with no flaky or skipped
  results; 6/6 critical scenarios; the no-identity macOS arm64 package gate with 12 packaged smoke
  and 15/15 packaged E2E scenarios; and 22 recovery cases from 20 sources. Hosted Ubuntu and
  four-target evidence remains pending because no commit, push, tag, or workflow dispatch was
  authorized.

## 2026-08-12

- Locally completed Checkpoint 29 manuscript-wide literal Find and exact navigation under accepted
  ADR 021. The implementation shares a locale-independent NFC matcher with the unchanged Agent
  tool, maps projection ranges back to original UTF-16 semantic spans, revalidates current
  authority before navigation, and adds the shadcn workspace Find surface with bounded pagination
  and non-mutating editor decorations.
- Final evidence: the 1,000-section/10,419,993-byte benchmark passed at p95 34.66 ms and maximum
  synchronous Main slice 12.02 ms; `check:fast`; 146 Electron-hosted files and 798 tests; a
  successful production build; 26/26 full Real-Electron scenarios; 25 recovery fixtures; clean
  scoped Impeccable detection plus fresh finish review/remediation; and `git diff --check`.
  Package/release, hosted CI, commit, tag, push, and publication were not run.
- Advanced the active release metadata from `0.2026.8.13` to `0.2026.8.14`. The accepted mapping
  keeps the package/application version at `0.2026.8` and advances macOS `CFBundleVersion` to
  `2026.8.14`. No commit, tag, package, push, hosted CI, signing, or publication was performed.
- Completed the Checkpoint 30 decision pass and recorded proposed ADR 022. The plan fixes the
  writable prose/structured-skip matrix, exhaustive ephemeral capability, default-empty bounded
  selection, one-transaction canonical application, post-commit materialization repair,
  per-section Undo, optional ready-only project checkpoint, mounted-editor reconciliation,
  performance gate, implementation slices, and acceptance matrix. Implementation remains
  unauthorized pending separate approval.
- Locally completed the subsequently authorized Checkpoint 30 implementation under accepted ADR
  022. Find now progressively exposes literal Replace with exhaustive preview, fixed structured
  skip reasons, default-empty bounded selection, exact revalidation, one-transaction canonical
  application, repairable post-commit materialization, narrow per-section Undo, optional ready-
  only project checkpoints, and mounted-editor reconciliation.
- CP30 evidence passed 148 Electron-hosted test files and 807 tests, the production build, 27/27
  full Real-Electron scenarios, 25 recovery fixtures, the 100-section/500-selection transaction
  benchmark at p95 16.44 ms, clean scoped Impeccable detection, and `git diff --check`. Release
  metadata advanced to `0.2026.8.15`; the no-identity macOS arm64 package gate passed 12 packaged
  runtime smoke and 17 packaged E2E scenarios and produced a verified no-Team-ID App, DMG, and ZIP.
  No commit, tag, hosted CI, Apple signing/notarization, push, publication, or promotion ran.
