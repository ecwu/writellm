# Phase 27: Stable References, Zotero Import, And Citation Workflow

Status: Checkpoint 78 is complete under ADR 070. Checkpoint 77
remains paused and is not a prerequisite for this independent Knowledge/publication boundary.
Recorded: 2026-08-31

## Checkpoint 78.0: Decision Gate

- [x] Accept ADR 070 and explicitly supersede the relevant ADR 020 and ADR 030 limitations.
- [x] Permit only a user-selected single bibliography file connector while retaining the
  project-wide watcher and general external-edit non-choices.
- [x] Record the Citation.js/citeproc exact-pin and license/distribution boundary.
- [x] Authorize CP78 ahead of the independently paused CP77.

## Checkpoint 78.1: Reference Authority And Zotero Import

- [x] Add forward project/app migrations, application-owned contracts, repositories, and bounded
  metadata snapshots.
- [x] Add Better CSL JSON and BibTeX parsing, deterministic citekeys, partial-entry reporting, and
  last-known-good synchronization.
- [x] Add the single-file connector lifecycle, stable-read watcher, manual refresh, and explicit
  PDF attachment preview/confirmation.

## Checkpoint 78.2: Citation Identity And Reference Library

- [x] Add bilingual citekey clusters, page locators, legacy compatibility, and a confirmed
  manuscript-wide conversion plan.
- [x] Project stable Reference identity through Knowledge tools and immutable review evidence;
  reject fabricated, unregistered, and metadata-only evidence keys.
- [x] Replace filename-first Knowledge management with the metadata-first Reference Library while
  preserving PDF, parse, index, and mapping capabilities.

## Checkpoint 78.3: CSL Formatting And Export

- [x] Add exact-pinned plugin-csl/citeproc through one background-worker adapter, snapshot hashing,
  cancellation, and bounded caching.
- [x] Add opt-in formatted citation display and one formatter snapshot for References and
  bibliography-aware publication.
- [x] Add deterministic CSL-JSON/BibTeX export, round-trip comparison, loss reporting, cited/all
  scope, and Pandoc package output.

## Acceptance criteria

Reference metadata and connector paths respect the three-database authority split; synchronization
never changes a project citekey, manuscript revision, index generation, or retrieval ranking;
legacy title citations continue to work; bilingual clusters and locators parse deterministically;
Agent evidence accepts only expanded registered keys; formatted preview and every bibliography-
aware export share one snapshot; broken connector input retains last-known-good data; Renderer
receives no filesystem path or database authority.

## Verification plan

- Focused migration, parser, citekey, connector state-machine, IPC, formatter, Agent-policy,
  publication, and Renderer tests.
- Cross-platform pure-logic watcher event tests for change/rename/unlink/recreate and stable reads;
  one local macOS Electron replacement E2E. Windows/Linux runtime behavior remains unclaimed until
  a separately authorized hosted matrix passes.
- `pnpm check:fast`, the canonical Electron suite, production build, complete E2E,
  `pnpm check:package`, frozen install, dependency/license audit, and `git diff --check`.
- CP78 itself did not authorize release actions. A later explicit authorization covers one local
  no-Team-ID build, source commit, annotated `v0.2026.8.48` tag, and atomic push of `main` plus the
  tag; signing, notarization, GitHub Release creation, promotion, and publication remain excluded.

## Local evidence

- ADR 070, the architecture amendment, CP78-ahead-of-CP77 authorization, exact dependency pins,
  CPAL distribution notice, and the app/project forward migrations are recorded and verified.
- The canonical Electron runner passed 226 files / 1,228 tests with three intentional benchmark
  skips; `pnpm check:fast` and `pnpm check:electron` passed, including a production build.
- The fresh macOS Electron suite passed all 47 scenarios. Pure-logic connector tests cover exact
  basename change/rename events (including unlink/recreate semantics) and reject unsettled reads;
  no Windows/Linux watcher runtime claim is made.
- The final `v0.2026.8.48` no-Team-ID macOS arm64 package gate passed 31 recovery fixtures from 29
  protected sources, 53,318 ASAR entries, 12 packaged smoke scenarios, and 34 packaged Electron
  scenarios. It produced a 238,989,574-byte DMG
  (`3cb327237e2f209129a25f8bcd9ed57946927d51b4e325cefbbe866a4c15b37a`) and a
  237,195,396-byte ZIP
  (`5abfc87272f80fb860f8f8b8970e0938fab58dbc8016b1c86c5dba6b41b4ebae`).
- `pnpm install --frozen-lockfile` passed. Production and full `pnpm audit` each reported no known
  vulnerabilities. Installed license metadata confirms `@citation-js/plugin-csl` 0.8.2 (MIT) and
  `citeproc` 2.4.63 (CPAL-1.0 OR AGPL-1.0); `THIRD_PARTY_NOTICES.md` records the selected CPAL
  distribution path. Scoped Impeccable detection and final diff checks passed.
- The explicitly authorized source commit, annotated `v0.2026.8.48` tag, and atomic push of `main`
  plus that tag were completed after this local evidence was recorded. Signing, notarization,
  GitHub Release creation, promotion, and publication were not performed.
