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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-27.md#local-evidence).