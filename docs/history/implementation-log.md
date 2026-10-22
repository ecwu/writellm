# Implementation History

This chronology records cross-phase work and maintenance that has no numbered Phase file.
Completed checkpoint details remain in the Phase files under `docs/implementation-todo/`.

Long entries recorded before 2026-10-22 are summarized here. Each summary links to its complete
original text at commit `493f02a`, which retains every command, count, digest, and
failure record. Decisions live in the ADRs, not in this log. New entries follow the format in
[ADR 092](../adrs/092-documentation-evidence-archive.md).

## 2026-07-16

- Completed Checkpoint 19.5 convergence and its audit remediation: ephemeral MinerU capabilities,
  seven durable job types, frozen Agent boundaries, three persistent worker roles, one atomic file
  writer, and 1536D sqlite-vec benchmark evidence.
- A source-level audit of Checkpoints 1–19 opened Checkpoints 19.6 and 19.7 for the remaining
  gaps. It also pruned recent-project pointers to five and removed superseded one-shot worker entry files.
- Archived the "Stable Default Window State" maintenance here from the removed `maintenance.md`.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-07-16).

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

- Completed Checkpoint 29 (manuscript-wide literal Find, ADR 021), Checkpoint 30 (safe
  manuscript-wide Replace, ADR 022), and Checkpoint 31 (bounded selection actions through the
  ordinary Agent conversation, ADR 023).
- Release metadata advanced through `0.2026.8.14`–`0.2026.8.16`. Each step produced a local no-Team-ID
  macOS arm64 App. No commit, tag, hosted CI, or publication ran.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-12).

## 2026-08-13

- Completed the remaining Phase 11 sequence: Agent-native review (ADR 024), Agent tasks and
  progress (ADRs 025–026), figure identity and asset catalog (ADRs 027–029), DOCX/LaTeX/PDF
  publication and presets (ADRs 030–031), Main-owned Markdown and LaTeX import (ADRs 032–034),
  annotations (ADR 035), project clone (ADR 036), and project templates (ADR 037).
- Final Phase 11 verification passed on macOS arm64 at `0.2026.8.16`. The application icon was
  replaced and then refined.
- Started Phase 12 (Use And Fix): Checkpoint 48 composer refinement (ADRs 038–040), Checkpoint 49
  Main-owned Follow-up queue (ADR 041, commit `45cb477`), and Checkpoint 50 Agent tool contract
  hardening (ADR 042, contract v8).

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-13).

## 2026-08-14

- Accepted ADR 043 and completed the authorized approval-semantics refinement. `manual` is
  unchanged; the middle mode is presented as Write Auto and applies every section, outline, and
  image proposal without block/character limits while Brief and Writing Rules changes still pause;
  `yolo` keeps its name and applies every proposal kind including Brief/Writing Rules changes.
  Persisted mode values, CHECK constraints, run snapshots, and IPC contracts are unchanged (no
  migration). New policy matrix tests and the updated session-service matrix passed (67 focused
  tests). No commit, push, hosted CI, package, or release action was performed.
- Accepted ADR 044 and completed the approval-mode decoupling refinement. `setApprovalMode` no
  longer refuses changes during an active run or pending review, proposal decisions read the
  session's current mode at proposal time instead of the run-start snapshot (kept as audit
  history), and the Renderer approval picker stays enabled during runs and review pauses. New
  mid-run and review-time mode-change tests passed in the focused suites (69 tests). No commit,
  push, hosted CI, package, or release action was performed.

## 2026-08-17

- Accepted ADR 046 and completed Checkpoint 51 to align Pi provider-context pruning with the active
  tool loop: current user anchoring, atomic assistant/result batches, full newest-read retention,
  non-authoritative projection of completed older reads, and one smaller sequential recovery before
  a no-replay terminal failure. Focused/static/Electron gates, 40/40 full Real-Electron scenarios,
  25 recovery fixtures, 12 packaged smoke scenarios, and 28/28 packaged E2E scenarios passed. The
  authorized delivery is one feature commit fast-forwarded to `origin/main`, explicitly excluding
  `cordis-reform`; package artifacts remain ignored and unpublished.

## 2026-08-18

- Local candidate `v0.2026.8.17` was tagged and built (no push or hosted CI).
- Completed Checkpoints 52–57:
  - Checks workspace with Knowledge citation coverage (ADR 047).
  - Cross-section image copy and move (ADR 048).
  - Writing-specific v3 compaction handoff (ADR 049).
  - Context-usage indicator (ADR 050).
  - Step capsule plan popover.
  - Fixed image-generation provider catalog with Gemini, OpenAI, and xAI (ADR 051, app.sqlite v9).

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-18).

## 2026-08-19

- Completed Checkpoints 58–61:
  - Preview workspace for the whole manuscript.
  - Google Vertex AI image source using local ADC (ADR 052), plus a large inline image repair.
  - Writing Skills as visible per-run tool reads (ADR 054).
  - `$skill-name` mentions (ADR 055).
- Local candidates `v0.2026.8.18`–`v0.2026.8.20` were tagged and built.
- Reconciled the plan, tracker, and Phase records after Checkpoints 48–61. The former CP27–28
  tracker evidence moved to `implementation-todo/phase-agent-writing.md`.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-19).

## 2026-08-20

- Completed Checkpoint 62, which reorganized Settings into General, Keyboard Shortcuts, and About
  & Diagnostics.
- Completed Checkpoint 63:
  - Agent thinking orbs and a review border beam.
  - One semantic Proposal dispatcher for the timeline and the Writing Task change set.
- Built local hands-on macOS arm64 Apps for both checkpoints.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-20).

## 2026-08-23

- Completed these checkpoints:
  - Checkpoint 64: bounded dependency refresh to Electron 43 (ADR 056).
  - Checkpoint 65: native Inline Math with schema v4 and migration 0037 (ADR 057).
  - Checkpoint 66: transient Notebook workspace (ADR 058).
  - Checkpoint 67: optional first-run onboarding (ADR 059).
  - Checkpoint 68: native Block Math and the schema-v5 plain-content Diagram, with migration 0038 and Agent contract v9 (ADR 060).
- Candidate `v0.2026.8.21` was tagged and pushed. Local candidate `v0.2026.8.22` was tagged and
  built with a DMG and ZIP.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-23).

## 2026-08-25

- Completed Checkpoint 71 (ADR 063): bounded complete-run compaction scanning, finalization of
  pathological tool loops, and recovery of Pi continuations.
- Completed Checkpoint 72 (ADR 064): disposable re-readable tool bodies, exhaustive continuation
  facts, and validation of the final escaped compaction prompt budget.
- Local candidate `v0.2026.8.25` was tagged at `456e837` and built.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-25).

## 2026-08-24

- Completed Checkpoint 69 (ADR 061): Agent Harness Protocol v10 `ask_user`, Main-owned in-run
  waiting, and the shadcn Questionnaire.
- Completed Checkpoint 70 (ADR 062): Notebook on the shared Pi session runtime as a read-only
  selected-source Agent.
- Local candidates `v0.2026.8.23` (`ecfca0b`) and `v0.2026.8.24` (`bc6227a`) were tagged and built.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-24).

## 2026-08-26

- Accepted ADR 065 and completed Checkpoint 73. The Agent sidebar now presents conversation status
  in its searchable header, groups sessions by attention, collapses successful activity into
  human-readable summaries, keeps a bounded inline Writing Task row and one prioritized attention
  dock above the composer, exposes only non-default composer context, and progressively discloses
  waiting follow-ups. Forty-six focused Renderer tests, `check:fast`, 200 Electron-hosted files /
  1,140 tests with three intentional benchmark skips plus production build, and the fresh 46/46
  Real-Electron manifest passed. Runtime inspection covered the 640 px desktop Agent sidebar;
  scoped Impeccable and `git diff --check` also passed. No dependency,
  database, IPC, Agent protocol, permission, persistence, package/release, commit, tag, push,
  signing, or publication action ran.
- Built the separately authorized local Checkpoint 73 macOS arm64 App from the current dirty
  worktree. The initial gate correctly stopped because CP72 had changed a protected Agent recovery
  source; its single manifest digest was refreshed and all 27 recovery cases from 25 sources then
  passed. The unpacked-only no-identity gate verified Electron 43.4.1 / ABI 148, arm64 native
  modules, 53,287 ASAR entries, 12/12 packaged smoke scenarios, and 33/33 packaged E2E scenarios,
  and produced `dist/macos-arm64/mac-arm64/WriteLLM.app`. No DMG, ZIP, candidate, commit, tag, push,
  hosted CI, Apple Developer ID signing, notarization, release, promotion, or publication ran.

## 2026-08-28

- Completed Checkpoint 74 (ADR 066, Protocol v11): hash-bound table reads, typed table edits, and
  table projection to portable Markdown, PDF, and LaTeX.
- Completed Checkpoint 75 (ADR 067, Protocol v12): layered tool descriptions, run-local
  capability groups, exact envelope budgets, and object-root schemas. Follow-up maintenance projected root-union
  properties for LM Studio compatibility.
- Provider Base URLs may use HTTP for localhost and numeric `10.*`, `100.*`, `127.*`, and `192.*`
  IPv4 hosts. Other hosts still require HTTPS.
- Built local trial Apps. Source candidate `0.2026.8.26` was committed, tagged, and pushed for Checkpoints 73–74.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-28).

## 2026-08-30

- Published `WriteLLM 0.2026.8` from immutable `v0.2026.8.45` as the first public, explicitly
  unsigned four-platform GitHub Release, with checksums and an unsigned release manifest.
- Completed Checkpoint 26.9 with run `33299058552`, which passed the shared static and fixture gate and four
  independent native build-only jobs. Hosted CI was narrowed to build-only packaging under revised
  authorization.
- Candidates `v0.2026.8.37`–`v0.2026.8.44` were retained as failed hosted evidence. Each exposed
  platform-specific E2E races, such as Floating UI reference loops, settlement waits, and timeouts,
  and each one's fix advanced the next candidate.
- Moved `pnpm/action-setup` to the Node 24-based v6.0.10.
- The Thermo-Nuclear P0/P1 audit found no P0 issues and remediated three P1 issues: atomic Writing Skill rollback,
  fail-closed schema roots, and the tag-CI source verifier. A structural remediation then removed
  duplicated logic and split oversized modules and tests.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-30).

## 2026-08-29

- Resumed Checkpoint 26.9 after the repository became public. Unsigned cross-platform CI was
  restored and limited to pushed tags.
- Candidates `v0.2026.8.27`–`v0.2026.8.36` were retained as failed hosted evidence:
  - pnpm 12 lock metadata.
  - Multibyte filenames and SQLite handles.
  - Windows CRLF and test budgets.
  - Linux credential backend lifetimes.
  - BlockNote and Floating UI loops.
  The validation matrix became four independent per-platform pipelines.
- Accepted ADR 068 and completed Checkpoint 76:
  - Sticky Ask, Plan, and Write ceilings.
  - Migration 0039 and Protocol v13.
  Checkpoint 77 stays paused.
- Aligned the pnpm pin to the approved 11.17.0.
- Maintenance:
  - Agent model-selection recovery after Provider changes.
  - Generated-image proposal terminalization and orphan recovery.
  - Gemini/Vertex blockless `read_section` compatibility.
  - Read-section title presentation.
  - Compaction status markers.
- Built local trial Apps.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-29).

## 2026-08-31

- Completed Phase 27 Checkpoint 78 (ADR 070):
  - Project-authoritative stable References.
  - One user-selected Zotero/Better BibTeX connector.
  - Bilingual citekeys.
  - Evidence-bound Agent citations.
  - CSL formatting and bibliography-aware export.
- Completed Phase 26 Checkpoint 76.1 (ADR 069): permanent content-addressed Agent request traces,
  with persistence acknowledged before provider dispatch.
- Candidates `v0.2026.8.46` (`1f53c5c`, pnpm 11.17.0 tag CI) and `v0.2026.8.47` (`7bb8552`) were
  built, tagged, and pushed. No release was published.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-31).

## 2026-08-31 — Checkpoint 78 candidate v0.2026.8.48

- Advanced release metadata to `0.2026.8.48` for the completed stable Reference, Zotero import,
  bilingual citation, CSL formatting, and bibliography export work under ADR 070.
- Rebuilt the no-Team-ID macOS arm64 App and passed the complete package gate: 31 recovery fixtures
  from 29 sources, 53,318 ASAR entries, 12 packaged smoke scenarios, and 34/34 packaged Electron
  scenarios. The gate produced a 238,989,574-byte DMG
  (`3cb327237e2f209129a25f8bcd9ed57946927d51b4e325cefbbe866a4c15b37a`) and a
  237,195,396-byte ZIP
  (`5abfc87272f80fb860f8f8b8970e0938fab58dbc8016b1c86c5dba6b41b4ebae`).
- Committed the source snapshot, created annotated tag `v0.2026.8.48`, and atomically pushed
  `main` plus the tag to GitHub under explicit authorization. Apple Developer ID signing,
  notarization, GitHub Release creation, promotion, and publication were not performed.
- Completed Agent staged-tool preflight and citation-recovery maintenance. The Worker now snapshots
  the exact model-visible tool specifications for each provider request and preserves the concrete
  policy rejection selected before dispatch. Activated tools with malformed arguments therefore
  report schema paths instead of `unknown_tool`, policy failures retain their actual cause, and
  duplicate diagnostics from the same model response are collapsed while Pi still receives each
  individual tool result. Main tracks only the active request's monotonic citation evidence state:
  a fresh failure requests `search_knowledge` then `read_citations`, a completed search resumes at
  `read_citations`, and expanded citations direct the model to repair its existing arguments. The
  two focused suites passed 37 tests; `check:fast` passed; and the Electron gate passed 215 files /
  3 skipped benchmark files and 1,194 tests / 3 skipped benchmark tests, followed by a successful
  production build. `git diff --check` passed. No staged-loading redesign, protocol version,
  database migration, dependency, package, release, commit, tag, or push action was performed.

## 2026-08-31 — Checkpoint 79 unified Reference import

- Completed Phase 28 Checkpoint 79 (ADR 070): one Reference-first prepare/confirm flow for Zotero
  metadata and PDF attachments, with no orphan `doc-*` References.
- Maintenance:
  - The Agent Knowledge reads now inject project Reference authority, and exact encoded `doc-*` tokens resolve.
  - Citation Coverage, availability checks, and citation clicks now use exact project citekeys.
- Built a local trial App.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-08-31--checkpoint-79-unified-reference-import).

## 2026-09-01 — Candidate v0.2026.8.49 Reference citekey maintenance

- Built and locally verified the user-authorized `v0.2026.8.49` no-Team-ID macOS arm64 trial
  candidate. The focused Citation Coverage E2E and all 48 fresh Electron E2E scenarios passed.
  The complete package gate verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries,
  all 12 packaged runtime smoke scenarios, and all 34 packaged Electron scenarios without flakes,
  skips, or failures. It produced a 239,026,198-byte DMG
  (`86a63b5c1c3bba4c7430843e03ee7f23e565312c57ffc9a0254a7735d23749ca`) and a
  237,205,662-byte ZIP
  (`0759070c04215d78b5ad2b2788a4cd9f4ff7b6410345b70086579b21a1ab17c7`) under
  `dist/macos-arm64`. The recovery fixture manifest was refreshed for the migrated Citation
  Coverage E2E assertions. Source commit, tag, and push remain pending; Developer ID signing,
  notarization, GitHub Release creation, promotion, and publication were not performed.
- Committed the verified source as `39e9a84`, created annotated tag `v0.2026.8.49`, and atomically
  pushed `main` plus the tag to GitHub under explicit authorization. The immutable tag points to
  the verified source commit. Apple Developer ID signing, notarization, GitHub Release creation,
  promotion, and publication were not performed.

## 2026-09-01 — Checkpoint 80 live Agent request retry

- Completed Phase 29 Checkpoint 80 (ADR 071). `Retry request` and `Continue` restore the exact live Pi
  request through a one-use Main-authorized capability, with a schema-v4 `model_retry` lineage
  event. They never duplicate user messages or replay tools.
- Non-blocking tool preflight failures render as compact expandable rows.
- Built a local `0.2026.8.49` trial App.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-01--checkpoint-80-live-agent-request-retry).

## 2026-09-01 — Checkpoint 81 token-pressure Agent context compaction

- Completed Phase 30 Checkpoint 81 under ADR 072. Ordinary automatic compaction now depends only
  on the final model-visible token budget; durable event count and payload bytes no longer trigger
  it. Provider-overflow recovery, the 2,000-event source ceiling, 180-event tool-loop finalization,
  payload-v3, recent raw turns, and rebuilt project authority remain unchanged.
- The single rolling summary now merges the prior checkpoint with newer events, carries still-active
  requirements and unfinished work, records superseded directions, and treats its `Next action` as
  background orientation. The latest real user message remains the current action source.
  `/compact` invokes the existing manual path immediately from the slash catalog without adding a
  user message; Add context remains scope-only and the header action retains its confirmation.
- Focused coverage passed 59 tests. `pnpm check:fast` passed; the complete Electron gate passed 229
  files and 1,246 tests with three benchmark skips plus the production build; and all 49 fresh
  Electron E2E scenarios passed without failures, flakes, or skips. `git diff --check` passed. No
  package, release, commit, tag, push, signing, notarization, promotion, or publication action was
  performed.
- Built and fully verified the separately authorized no-Team-ID macOS arm64 App containing the
  completed Checkpoint 80 and Checkpoint 81 changes. The package gate verified 31 recovery fixtures
  from 29 sources, 53,318 ASAR entries, all 12 packaged runtime smoke scenarios, and all 34
  packaged Electron scenarios without failures, flakes, or skips. It produced
  `WriteLLM-0.2026.8.49-arm64.dmg` (239,010,230 bytes,
  `e69917cb1e44b1125962b68b3d790bb279e24172381facc76325ecd24e7a49c4`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,206,167 bytes,
  `6779135acae153e2d4528df991a51fb4477824d5e626e5230c9ec264f07d8bad`) under
  `dist/macos-arm64`. No Developer ID signing, notarization, tag, release, promotion, or
  publication action was performed.

## 2026-09-01 — Checkpoint 82 explicit Writing Skill injection

- Completed Phase 31 Checkpoint 82 under ADR 073. Leading `$skill-name` requests now resolve in
  Main to one atomic first-request package containing ordered roots and a stable, deduplicated
  dependency closure. Automatic candidates remain metadata-only and continue through visible
  `read_writing_skill` calls. Explicit success creates no synthetic tool activity; explicit
  ambiguity, unavailability, cycles, limits, integrity, or budget failure drops the whole package,
  records a degraded schema-v3 snapshot, and continues with the valid automatic catalog.
- Removed every incomplete-Skill preparation gate from assistant deltas, downstream tools, final
  answers, and run settlement. Automatic root-only, partial-dependency, failed-read, and no-Skill
  runs can complete normally. The one-entrypoint and no-mixed-tool protocols remain recoverable
  tool errors. New runs route from current user text and current registry state rather than replaying
  prior snapshots; historical `skill_request_unfulfilled` parsing and display remain readable.
- Two focused batches passed 96 and 84 tests. `pnpm check:fast` passed; the clean Electron gate
  passed 229 files and 1,253 tests with three benchmark skips plus the production build; and all 49
  fresh Electron E2E scenarios passed without failures, flakes, or skips. The scoped Impeccable
  detector and `git diff --check` passed. No package, release, commit, tag, push, signing,
  notarization, promotion, or publication action was performed.

## 2026-09-02 — Checkpoint 82 trial package

- Refreshed the recovery manifest for the three intentionally changed protected Agent test sources
  and replaced the obsolete fail-closed Skill test name with the CP82 non-blocking completion test.
  The complete no-Team-ID macOS arm64 package gate verified 31 recovery fixtures from 29 sources,
  53,318 ASAR entries, all 12 packaged runtime smoke scenarios, and all 34 packaged Electron
  scenarios without failures, flakes, or skips. The default parallel packaged-E2E attempt first
  exposed host-load window-startup timeouts; the complete gate passed with its supported
  interactive single-worker mode without terminating the user's existing app.
- Produced `WriteLLM-0.2026.8.49-arm64.dmg` (239,010,676 bytes,
  `cfc8551ecbc8043e0cf2f7f4ca2550d8782df950fa6006751f78055008a0b10d`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,203,201 bytes,
  `0edfbf0b7b570f892b3c4d589afb12f88b598dfb3219f393c0acebc2dbc34624`) under
  `dist/macos-arm64`. No Developer ID signing, notarization, release, commit, tag, push, promotion,
  or publication action was performed.

## 2026-09-02 — Checkpoint 83 Agent Occam ablation and error propagation

- Completed Phase 32 Checkpoint 83 under ADR 074. Removed event-count finalization, duplicate
  project/Worker admission caps, rolling compaction budgets, one-recovery read state, Skill count
  and preload gates, trace ACKs, and live retry capabilities/UI. Context now uses one old-prefix
  summary plus recent raw turns; Skills are progressive and trace recording is best effort.
  Protocol v14, v4 context/Skill snapshots, and v2 safe failure diagnostics retain legacy readers
  without a database migration. Production runtime code is reduced by 778 lines.
- Deterministic replay and fault injection cover each removed guard and retained authority,
  privacy, approval, mutation, and no-replay invariant. Focused suites, `check:fast`, 1,275
  Electron-hosted tests with three benchmark skips, the production build, all 49 fresh silent
  E2E scenarios, the scoped Impeccable detector, and final style/diff checks passed.
- The full no-Team-ID macOS arm64 package gate passed with 31 recovery fixtures, 53,318 ASAR
  entries, 12 packaged runtime smoke scenarios, and 34/34 packaged E2E scenarios without
  failures, flakes, or skips. The verified App, DMG, and ZIP are under `dist/macos-arm64`.
  Detailed ablation evidence, artifact hashes, and the upstream Pi cause-loss limitation live in
  [`../implementation-todo/phase-32.md`](../implementation-todo/phase-32.md).
- No real provider, dependency/setting addition, migration, release, commit, tag, push, Developer
  ID signing, notarization, promotion, or publication action was performed.

## 2026-09-02 — Recent-project removal and explicit close/quit actions

- User-authorized maintenance adds an accessible remove button to each recent project. Main
  validates the opaque project ID and reuses `RecentProjectsRepository.remove`; only the
  `app.sqlite` pointer is removed. Manual reopening uses the existing upsert to restore it.
- Removed the Switch project menu entry. Close project and return to chooser preserves the
  existing final-flush/session-revocation path. Quit WriteLLM validates sender authority, closes
  any open project, requires the closed lifecycle state, and then enters the existing shutdown
  coordinator. A failed close keeps the app running for recovery. No migration or dependency change.
- Verification: `pnpm check:fast`; 45 tests across project IPC, application IPC, recent-project
  persistence, and shutdown coordination; `pnpm build`; and the focused `project.lifecycle-restart`
  Electron E2E scenario passed. Runtime: Electron 43.4.1, embedded Node 24.18.1, ABI 148, macOS
  arm64. Host pnpm 11.17.0 matched the manifest; host Node 26.8.1 produced an engine-range warning,
  with no toolchain or manifest changes. The scoped Impeccable detector reported no findings.
- Real E2E evidence covers pointer removal without manifest mutation, persistence across restart,
  manual reopening restoring the row, chooser-based project changes, stale-session rejection,
  exit from the chooser and an active editor, and final-edit persistence after quit/restart.
  Initial runtime verification caught a missing TooltipProvider, which was corrected; a subsequent
  test-cleanup failure after successful quit was corrected by retaining the process handle before
  shutdown. The final run passed without renderer errors, retries, skips, or flakes. Chooser and
  menu screenshots were inspected. Existing E2E close locators were updated to the explicit label.
- No package, release, signing, commit, tag, or push action was performed.

## 2026-09-02 — Desktop-only test and documentation boundary

- The user explicitly authorized removing narrow-window/mobile adaptation and verification
  requirements, including targeted cleanup of historical ADR and Phase text. Product guidance
  retains normal desktop Agent sidebar usability, control non-overlap, keyboard access, and
  panel resizing. Existing UI implementations and window defaults are unchanged.
- Removed dedicated window shrinking, breakpoint waits, mobile navigation, geometry assertions,
  and screenshots from six Electron E2E files. Independent editing, Find/Replace, persistence,
  preview, math, citation, accessibility, and Agent checks remain at desktop sizes. All 28 scenario
  IDs and suite tags are preserved; the test files have 226 fewer lines than the starting worktree.
- Verification: `pnpm check:fast`, `pnpm build`, and the six-file focused `pnpm test:e2e` run passed
  all 28 scenarios in 1.1 minutes without failures, retries, flakes, or skips. The run enabled
  `WRITELLM_CP73_SCREENSHOT_DIR` and exercised the retained desktop Agent panel resize and
  screenshot branch. E2E ran outside the sandbox through the normal silent runner.
- Runtime: Electron 43.4.1 / ABI 148, macOS arm64; host pnpm 11.17.0 matches the manifest. Host
  Node 26.8.1 emits the existing warning against the declared Node 24.x engine range. The gates
  passed without changing the host toolchain, dependencies, or version pins.
- Final tracked-document and test audits found no remaining narrow-window acceptance requirement
  or dedicated test path. Desktop policy exclusions, ordinary sidebar checks, narrow authority
  boundaries, and performance responsiveness terminology remain intentional. `git diff --check`
  passed.
- No product implementation, API, schema, package/release, signing, commit, tag, or push change
  was made by this maintenance; unrelated starting worktree changes were preserved.

## 2026-09-02 — Layered verification and single-assembly packaging

- Separated build from verification:
  - Plain builds compile without checks.
  - Composite gates own static checks and one compile.
  - `check:full` and `check:package:smoke` were added.
  - Ordinary changes default to focused tests.
- The package gate now assembles one App, tests it, and reuses it through `--prepackaged` for installers.
- Excluded dependency source maps, declarations, and SQLite compiler sources. ASAR shrank about
  48%, and the DMG and ZIP shrank about 19%. Removed custom ASAR, native, and recovery test-source hashes.
- Added shared stage timing reports under `.cache/verification/`.
- The first complete `check:package` run passed on macOS arm64 in 187.9 s.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-02--layered-verification-and-single-assembly-packaging).

## 2026-09-02 Agent Panel presentation maintenance

- Unified Agent Panel content under ADR 075:
  - `projectAgentPresentation` owns message, activity, change, question, compaction, and notice
    projection for both the timeline and Details.
  - A static exhaustive tool table replaced scattered name switches.
  - Live and durable prose share one renderer, and settlement is atomic.
- Renderer-only change, verified by focused Renderer tests, six Electron scenarios, and desktop screenshots.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-02-agent-panel-presentation-maintenance).

## 2026-09-02 Agent model configuration and output completion

- Under ADR 076, which supersedes ADR 014's manual and custom reasoning exclusion:
  - Main derives runtime identity, reasoning, context, and output limits from one current catalog resolution.
  - Interactive output defaults to the model's declared allowance.
  - Manual reasoning metadata reaches Pi unchanged.
- A `length` stop now fails the run as `output_limit_reached`. Interrupted text is preserved and
  excluded from later context.
- Settings broadcasts the credential-free catalog snapshot directly to the Agent and Notebook selectors.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-02-agent-model-configuration-and-output-completion).

## 2026-09-03 Local build 0.2026.9.1

- Authorization: the user requested an App build followed by a commit of the current code and
  a `0.2026.9.1` tag. The tag uses the existing `v0.2026.9.1` canonical spelling required by
  `verify-release-source.mjs`. Package SemVer is `0.2026.9`; release metadata and artifact names
  carry `0.2026.9.1`; the macOS bundle build is `2026.9.1`.
- `pnpm install --frozen-lockfile --offline` passed in 4 seconds, preserving the lockfile and
  exact pnpm 11.17.0 toolchain. Native preparation verified Electron 43.4.1 / ABI 148 with
  better-sqlite3 12.11.1 and sqlite-vec 0.1.9. Existing Agent repair source coverage (115 focused
  tests and five Electron scenarios) was reused because only version metadata changed afterward.
- One `pnpm check:package` invocation passed in 188.0 seconds, using one production build and
  one assembled App. Static checks took 10.4 seconds, build/native preparation 11.4 seconds,
  App assembly 20.1 seconds, runtime smoke 39.5 seconds, packaged E2E 84.3 seconds, and installers
  from that same App 21.7 seconds. All 31 recovery fixtures from 29 sources, native/resource
  inventory, 12 runtime smoke scenarios, and all 34 packaged E2E scenarios passed. There were
  zero failures, retries, flakes, or skipped scenarios. Signature inspection verified the accepted
  no-Team-ID ad-hoc/linker signature.
- Output: `dist/macos-arm64/mac-arm64/WriteLLM.app`, `WriteLLM-0.2026.9.1-arm64.dmg`
  (194,631,862 bytes), and `WriteLLM-0.2026.9.1-arm64.zip` (192,544,089 bytes).
  DMG SHA-256: `3cfa5182040c619733ad1d9911aca12b55fb582db7feee6bbe0ecb8872c090fe`.
  ZIP SHA-256: `ae54eba6ccd2c9c2515d3885f75abeeb3c822177df032c8ced44d5c91efc6a68`.
  Evidence: `dist/macos-arm64/package-evidence.json` and
  `.cache/verification/1788389930863-8969-23a73ef3/`.
- The package was built from the working tree before the requested commit; its original evidence
  retains that provenance rather than claiming a clean tagged build. Final documentation changes
  do not change the built application. `pnpm check` and `git diff --check` passed before the local
  commit and annotated tag. Other-platform builds, remote push, Developer ID signing,
  notarization, GitHub Release creation, and publication are outside this request. Host Node
  26.8.1 retains the pre-existing engine-range warning; tests run in the canonical Electron runtime.

## 2026-09-03 Pi runtime upgrade

- Upgraded Pi Agent Core and Pi AI to exact `0.84.4`. Conversation usability now follows
  WriteLLM's event schema rather than the recorded Pi version, which remains creation provenance only.
- Adapted to the new lifecycle hooks (`shouldStopAfterTurn`, `prepareNextTurnWithContext`) and disabled
  Anthropic's automatic model fallback.
- Catalog and credential stores became cancellable, and the scoped model-store wrapper was removed.
- The complete package gate passed. The local `0.2026.9.1` artifacts were rebuilt from the dirty tree.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-03-pi-runtime-upgrade).

## 2026-09-03 Pi App rebuild

- At the user's request, `pnpm build:unpack` rebuilt the current Pi 0.84.4 working tree with
  task-local Node 24.15.0 and pnpm 11.17.0. The macOS arm64 build passed all four build stages
  in 33.3 seconds without retries: production build/native preparation (11.8 seconds), App
  assembly (21.3 seconds), no-Team-ID signature policy, and inventory of 33,383 ASAR entries.
- Output: `dist/macos-arm64/mac-arm64/WriteLLM.app`, with unchanged `0.2026.9.1` release
  metadata and dirty-source provenance. The build command refreshed its output directory and
  removed the preceding DMG/ZIP files. Evidence: `dist/macos-arm64/package-evidence.json` and
  `.cache/verification/1788421662296-10029-d3a0b461/`.
- This build-only invocation ran no functional tests; the Pi upgrade's final-source unit,
  packaged smoke, and E2E results above remain applicable. Other platforms were not built.
  No commit, tag, push, or publication was performed.

## 2026-09-03 Dependency security and maintenance refresh

- Applied the approved patch and minor updates for provider, Renderer, formatting, data, PDF, Mermaid,
  TypeBox, and test packages.
- Overrides repaired the vulnerable transitive packages Tiptap, browserslist, xmldom, and fast-uri. The audit reported zero
  advisories.
- Major migrations remained deferred: Vite 8, Vitest 4, TypeScript 7, Electron 44,
  better-sqlite3 13, Kysely 0.29, and KaTeX 0.18.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-03-dependency-security-and-maintenance-refresh).

## 2026-09-03 Release 0.2026.9.2

- Authorization: the user requested a build, the `9.2` tag, and publication of the
  GitHub Actions-built release as `0.2026.9.2`.
- Release source is commit `975d88b0f4e5497770ee4ea79b7320bc51a852fe`, whose release metadata
  resolves to package version `0.2026.9`, release version `0.2026.9.2`, build number `2`, and
  macOS build version `2026.9.2`. The annotated tag `v0.2026.9.2` was created and pushed.
- Local `pnpm check:package` passed in 187.7 seconds across 10 stages for macOS arm64. It
  covered static checks, 31 recovery fixtures, production build, native/resource inventory,
  12 packaged runtime smoke scenarios, all 34 packaged E2E scenarios, and DMG/ZIP installer
  creation with artifact checksums. The local package gate had no failures, retries, flakes, or
  skips.
- GitHub Actions run
  [33761788245](https://github.com/ecwu/writellm/actions/runs/33761788245) passed the shared
  static/fixture gate and all four native build jobs: macOS arm64 (5m26s), Windows x64 (5m26s),
  Linux x64 (5m12s), and macOS x64 (8m05s). The run produced seven installers and one evidence
  file per platform; the evidence records the source revision and package SHA-256 values.
- GitHub Release
  [`WriteLLM 0.2026.9.2`](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.2) was
  published with the Actions-built macOS arm64 DMG/ZIP, macOS x64 DMG/ZIP, Windows x64 NSIS
  installer, Linux x64 AppImage/DEB, and four renamed platform evidence JSON files. The
  packages are explicitly unsigned and not notarized. The enabled tag workflow is a build/upload
  workflow; the local macOS arm64 package gate supplies the full packaged runtime and E2E result.
- The tag push was intentionally limited to `v0.2026.9.2`; the release source commit is included
  in that immutable tag. This documentation synchronization is a post-release local commit and
  does not retag or alter the published release.

## 2026-09-03 `/cite` Reference search maintenance

- Added caret-local `/cite`: one read-only, session-authorized Reference search IPC returning at
  most three ranked candidates (citekey, title, authors, year). Selection inserts the
  authoritative `[@key]` as an independently undoable edit.
- A macOS arm64 App was built, and the user authorized committing and pushing the source.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-03-cite-reference-search-maintenance).

## 2026-09-03 Review fixture and annotation removal

- Under ADR 077, which supersedes parts of ADRs 024 and 035, removed:
  - Review Center and manuscript Annotations.
  - Deterministic draft checking and the Review Issue tools and state.
  - Proposal reconciliation.
  Protocol v15 drops the four tools.
- Writing Rules moved to `features/writing-rules`. Proposal review is unchanged.
- Forward-only migration 0043 strips the deleted state behind the verified backup and then runs integrity checks.
- `check:full` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-03-review-fixture-and-annotation-removal).

## 2026-09-03 Candidate 0.2026.9.3 build and tag

- Authorization: after the Review fixture and annotation removal, the user requested an App build
  and, on success, a new `9.3` tag pushed to GitHub. The repository's existing version convention
  resolved this to release version `0.2026.9.3` and annotated tag `v0.2026.9.3`.
- Release metadata was advanced from `0.2026.9.2` to `0.2026.9.3`. Release commit
  `f53feb462b2140460ecf9fadc9ee6cf8b92046aa` resolves to package version `0.2026.9`, build number
  `3`, and macOS build version `2026.9.3`.
- The final clean-source `pnpm build:unpack` passed all four macOS arm64 build-only stages in 29.9
  seconds: production build/native validation in 10.8 seconds, App assembly in 18.9 seconds,
  no-Team-ID ad-hoc/linker signature-policy verification, and inventory of 33,569 ASAR entries plus
  arm64 `better-sqlite3` and `sqlite-vec`. Output:
  `dist/macos-arm64/mac-arm64/WriteLLM.app`; evidence:
  `.cache/verification/1788469791340-33015-9c1d03e9/` and
  `dist/macos-arm64/package-evidence.json`.
- One earlier sandboxed package attempt reached production compilation but could not resolve
  `github.com` while electron-builder fetched its runtime. It was interrupted and the exact gate
  was rerun once in the authorized host environment; the final host run passed with a clean source
  revision.
- `main` advanced through the Review removal commit and release metadata commit, and both `main`
  and annotated tag `v0.2026.9.3` were pushed to `github.com:ecwu/writellm.git`. This candidate does
  not claim installer creation, a complete package/release gate, signing identity, notarization,
  GitHub Actions completion, or GitHub Release publication.

## 2026-09-03 PDF Reference import limit maintenance

- Removed the PDF-only 50-Reference prepare and confirmation restrictions from the shared
  contracts, Main connector service, and Renderer preflight. PDF and metadata-only review now use
  the same existing bounded 500-candidate request capability, and result projection accepts all
  outcomes from that request.
- Raised the private/public PDF preview capacity from 100 to 500 attachments so a 500-Reference
  batch with one PDF per Reference does not silently lose later attachments. Existing per-Reference
  attachment, file-size, candidate, expiring-preview, one-use, sender, and project-session bounds
  remain unchanged; no filesystem, database, RAG, worker, or dependency boundary changed.
- Focused shared-contract and connector verification passed 2 files / 10 tests in 1.7 seconds.
  Final-source `pnpm check:fast` passed all three stages in 10.4 seconds after one earlier
  format-only retry. The host
  Node 26.8.1 versus repository Node 24 engine warning remains an environment limitation; tests
  used the canonical Electron runtime. No build, package, release, commit, tag, push, signing, or
  publication action was performed.
- At the user's subsequent request, `pnpm build:unpack` produced a fresh macOS arm64 App from the
  dirty working tree. The host-environment rerun passed all four build-only stages in 32.1 seconds:
  production build/native validation in 12.1 seconds, App assembly in 19.9 seconds, no-Team-ID
  signature policy, and inventory of 33,569 ASAR entries plus the arm64 native modules. The first
  sandboxed attempt compiled successfully but could not resolve `github.com` while electron-builder
  fetched its runtime and was interrupted; it supplied no successful build evidence. Output:
  `dist/macos-arm64/mac-arm64/WriteLLM.app`; evidence:
  `.cache/verification/1788471207203-35691-84f9770d/` and
  `dist/macos-arm64/package-evidence.json`. No functional test, installer, release, commit, tag,
  push, signing identity, notarization, promotion, or publication action was performed.

## 2026-09-03 Silent count-limit removal

- Removed three silent user-visible count limits:
  - Knowledge batch selection (51+ files).
  - Reference attachment counts, replaced by 20-item session-bound continuation pages.
  - The 20-occurrence readable-citation preview.
- Byte and capacity limits remain, as do authorization, expiry, and bounded concurrency and page controls.
- Built a macOS arm64 App.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-03-silent-count-limit-removal).

## 2026-09-04 Reference import review distillation

- Reworked Reference and PDF import confirmation into exception-first `Needs attention` and compact
  `Ready to import` sections, with per-item progressive disclosure and a wider adaptive dialog.
  Renderer only. Built a replacement App.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-reference-import-review-distillation).

## 2026-09-04 Project sidebar resizing

- Added one shared, pointer- and keyboard-resizable shadcn Sidebar boundary (240–480 px) to the
  expanded desktop project shell. The icon rail and collapse behavior are unchanged.
- Built a replacement App.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-project-sidebar-resizing).

## 2026-09-04 Redundant-defense cleanup

Removed redundant validation while preserving behavior:
- Editor save disposition now comes from the revision ID.
- Worker runs use schema defaults.
- Agent section flattening keeps validated types.
- Run records no longer parse Skill snapshots twice.
- Theme resolution uses Electron's matchMedia directly.

No contract, migration, or dependency changed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-redundant-defense-cleanup).

## 2026-09-04 pnpm command consolidation

- Reduced package scripts from 51 to 30:
  - Removed `check:electron`.
  - Replaced platform and `build:*` aliases with `package` and `package:unpack --target=<target>`.
  - Replaced mode aliases with flags such as `--visible`, `--suite=critical`, `--force`, and `--write`.
- Synchronized the README command catalog and migration table, plus the agent rules. Historical
  ADR examples keep their original names.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-pnpm-command-consolidation).

## 2026-09-04 Manual feature trial App

The user requested a current App build for manual feature trials after pnpm command consolidation.
`pnpm package:unpack` used the existing Node 24.15.0 and pnpm 11.17.0 toolchain to build the
macOS arm64 App from revision `809621e39bb11f10efd0b2894682b5444fad7e8d` with a documentation-only
tracker change. Release metadata remains `0.2026.9.3`.

- The first attempt passed native preparation and compilation but package assembly encountered
  sandbox DNS failure (`ENOTFOUND github.com`), exiting after 54.6s. The same command was retried
  once outside the sandbox with approved network access.
- The successful retry passed all four build-only stages in 31.2s: production build (including
  Electron 43.4.1 / ABI 148 native preparation), App assembly, no-Team-ID ad-hoc/linker signature
  policy, and resource inventory. Inventory includes 33,569 ASAR entries and arm64 better-sqlite3
  and sqlite-vec binaries.
- App: `dist/macos-arm64/mac-arm64/WriteLLM.app`. Evidence:
  `dist/macos-arm64/package-evidence.json` and
  `.cache/verification/1788556216531-11728-28f727e4`. Failed sandbox attempt:
  `.cache/verification/1788556150194-11056-a7e05aea`.
- This was a build for user-driven trials, not functional acceptance. No functional tests,
  installers, signing identity, notarization, release, commit, or push were requested or run.
  Final documentation changes are checked with Biome and `git diff --check`; coverage is
  macOS arm64 only.

## 2026-09-04 Pi 0.85.0 dependency update

- Updated Pi AI and Agent Core from 0.84.4 to exact 0.85.0. `loadSourcedSkills` now receives Pi's
  `BACKGROUND_CONTEXT`, adding no new authority. Event schema v4 is unchanged.
- `check:package:smoke --unpacked-only` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-pi-0850-dependency-update).

## 2026-09-04 Pi 0.85.0 App build

The user requested a fresh App after the Pi dependency update. `pnpm package:unpack` used the
existing Node 24.15.0 and pnpm 11.17.0 toolchain and passed four build-only stages in 32.3s,
without retries: production build with Electron 43.4.1 / ABI 148 native preparation, App assembly,
no-Team-ID ad-hoc/linker signature policy, and a 33,981-entry resource inventory.

The macOS arm64 App is `dist/macos-arm64/mac-arm64/WriteLLM.app`, containing Pi AI and Agent Core
0.85.0 under unchanged release metadata `0.2026.9.3`. The preceding 189-test and 12-scenario
packaged smoke results still cover the application source; this invocation runs no functional
tests or installers. No commit, push, signing identity, notarization, or publication occurred.
Final documentation checks use `pnpm check` and `git diff --check`.

Evidence: `dist/macos-arm64/package-evidence.json` and
`.cache/verification/1788556777954-17830-984fea1e`. Runtime/build coverage is macOS arm64 only.

## 2026-09-04 Manuscript comments and Agent resolution

Checkpoint 84 implemented ADR 078 project-local manuscript comment threads:
- Migration 0044, with range invalidation triggered by section revisions.
- Exact or unique-block reattachment, otherwise orphaning.
- Agent tool contract v16 with comment list, read, reply, and resolve.
- Comments are excluded from exports.

### 2026-09-04 Comment acceptance correction

Independent acceptance review invalidated the first completion claim. Four acceptance probes
failed: replacement anchors, duplicate occurrences, orphaned resolution, and zero-block reads.
Phase 33 records the details.

### 2026-09-05 Comment acceptance remediation

Fixed anchors with transactional canonical mapping and forward migration 0045. Also enforced fixed session
delegation and complete fresh-read verification, made undo reopen only the dependent resolution,
and repaired the comment UI. Phase 33 records the evidence.

### 2026-09-05 Gemini stream truncation

A Gemini run failed after 470 ms with the Google SDK diagnostic `Incomplete JSON segment at the
end`. That exact diagnostic now joins the existing pre-content retry classification as
`stream_ended`. The five-attempt limit and other JSON errors are unchanged.

### 2026-09-05 Ponytail UTF8 cleanup

Agent title context, image iteration, and proposal previews now reuse the single complete-code-point
UTF-8 prefix helper in `session-history.ts`.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-04-manuscript-comments-and-agent-resolution).

## 2026-09-05 Notebook repeated citations

- The user authorized rendering every valid Notebook citation occurrence after repeated references
  were shown as raw `[[cite:n]]` text. The architecture amendment supersedes only ADR 058's
  duplicate-marker rejection; the completed ADR remains historical evidence.
- Removed Renderer occurrence deduplication and Main's duplicate-marker security warnings.
  Every registered occurrence uses the existing citation button and preview callback. Unknown
  ordinals, malformed markers, and forged citation URLs retain their existing protections.
- Updated the conversion regression and added a service regression for repeated registered
  citations without rejection warnings. `pnpm test src/renderer/src/features/agent/agent-markdown.test.ts
  src/renderer/src/features/agent/agent-markdown.test.tsx src/main/knowledge/knowledge-chat-service.test.ts`
  passed 3 files / 15 tests in 3.4 seconds with no retries. `pnpm check:fast` passed all three
  stages in 11.2 seconds. Tests used Electron Node 24.18.1, ABI 148; the host wrapper used Node
  26.8.1 and emitted the existing engine-range warning. pnpm 11.17.0 matches the project pin.
- No IPC, persistence, dependency, or preview interaction implementation changed. Real Electron
  UI and packaged App verification were not run for this marker-conversion/logging correction;
  the existing packaged App was not rebuilt. No other platform runtime was verified.

## 2026-09-05 Reference Knowledge sidebar redesign

- Redesigned the Reference Knowledge sidebar:
  - Reference rows own expandable attachments and status.
  - Filters and sorting were added.
  - Explicit selection ownership survives search and deletion.
  - An overlay import replaced the permanent drop zone.
- Job DTOs project only safe subjects. Activity groups current work, and history moved into a
  paginated dialog.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-05-reference-knowledge-sidebar-redesign).

## 2026-09-05 Sidebar App build

- The user requested a runnable App containing the latest sidebar changes. Ran
  `pnpm package:unpack` for macOS arm64 from clean source revision
  `47f82687802b9a0575e673c9b84a7641ffed0587`.
- The first sandbox run compiled successfully but electron-builder failed to resolve github.com
  (`ENOTFOUND`); that attempt ended after 54.5 seconds. Retried the same command with elevated
  network access. All four build-only stages passed in 31.7 seconds: production build (11.1s),
  App packaging (20.4s), no-Team-ID ad-hoc/linker signature policy, and package inventory.
- Output: `dist/macos-arm64/mac-arm64/WriteLLM.app`. Inventory verified Electron 43.4.1 / ABI 148,
  arm64 better-sqlite3 12.11.1 and sqlite-vec 0.1.9, and renderer asset
  `out/renderer/assets/index-B3XZgyKu.js`. Report:
  `.cache/verification/1788628754659-57916-333c84b9`.
- This build reuses the previously recorded functional evidence; no new functional tests,
  packaged runtime smoke, installers, Developer ID signing or notarization were requested or run.
  Host Node 26.8.1 emitted the existing engine-range warning; pnpm 11.17.0 matches the pin.

## 2026-09-06 Pi 0.85.1 Astra update

- The user requested the latest Pi update for Astra. Registry metadata and the
  [0.85.1 release changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/CHANGELOG.md)
  confirm its September 5 release adds GPT-6 Astra for OpenAI API keys and Codex subscriptions,
  plus a Responses prompt-cache TTL fix. Context7's unreleased label was stale; the official
  release tag resolved that discrepancy.
- Exact AI/Core pins and runtime metadata advance from 0.85.0 to 0.85.1. The lockfile changes
  only AI, Core, Chord and Telemetry. Frozen installation passed with existing Node 24.15.0 and
  pnpm 11.17.0; no adapter implementation, migration, or supply-chain policy change was needed.
  Added one catalog regression test proving both Astra presets survive WriteLLM's projection
  with the correct transport, reasoning support, image input, and verified metadata.
- Eight focused Electron-hosted test files / 93 tests passed in 4.0s (3.51s Vitest), including
  catalog, stream/retry, session, historical conversation, Skill loader, and runtime contracts.
  `pnpm check:package:smoke` passed six stages in 84.6s: static checks, one production build,
  App assembly, signature policy, resource inventory, and all 12 runtime smoke scenarios.
  No failures, retries, or skips. Electron 43.4.1 / ABI 148 and native arm64 modules were verified.
- App: `dist/macos-arm64/mac-arm64/WriteLLM.app`, retaining release metadata `0.2026.9.3`.
  Coverage is macOS arm64 with fixture providers; live Astra generation and other platforms
  were not exercised. No installer, commit, push, or publication was performed. Existing user
  documentation changes were preserved; final documentation receives diff/link review.

Reports: `.cache/verification/1788710229462-62028-b9373a90` (focused tests) and
`.cache/verification/1788710244835-62192-84668b93` (package smoke).

## 2026-09-06 Curated Writing Skill refresh

- Advanced two curated catalog pins: Nature to `28150f3` and CCFA to `217f687`.
- Updated blob hashes and allowlisted seven additional in-directory text references, bringing the total to 61 files.
- The ADR 013 rules are unchanged: immutable pins, text-only allowlists, and no bundled third-party bodies.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-06-curated-writing-skill-refresh).

## 2026-09-06 Writing Skill App build

- The user requested packaging after the curated Writing Skill refresh. Ran
  `pnpm package:unpack` for macOS arm64, preserving the existing working-tree Pi 0.85.1 changes
  and release metadata `0.2026.9.3`.
- The first invocation passed compilation and native loading but failed at electron-builder's
  GitHub lookup with sandbox `ENOTFOUND` after 54.9s. The same command with elevated network
  access passed all four build-only stages in 34.1s: production build (12.4s), App assembly
  (21.5s), no-Team-ID ad-hoc/linker signature policy, and package inventory.
- Output: `dist/macos-arm64/mac-arm64/WriteLLM.app`. Inventory verified 33,981 ASAR entries,
  Electron 43.4.1 / ABI 148, arm64 better-sqlite3 12.11.1 and sqlite-vec 0.1.9. A read-only ASAR
  inspection confirmed Nature `28150f30f8b4017991fca8c7b2839f02c6586d2f` and CCFA
  `217f68774a6703ba8b8fad602fdb47641ff77c6d` in the packaged Main bundle.
- Reused the catalog's prior static and focused functional verification. No new functional suite,
  packaged runtime smoke, installer, Developer ID signing, notarization, commit, push or publication
  was performed. Host Node 26.8.1 emitted the existing engine-range warning; pnpm 11.17.0 matches
  the project pin. Installed user Skills were not automatically replaced. Other platforms remain
  unverified. Documentation passed diff and local evidence-link review.
- Reports: `.cache/verification/1788722387777-13543-38d33f48` (sandbox failure) and
  `.cache/verification/1788722460223-14250-cde85d1a` (successful App build).

## 2026-09-08 — Agent message copy and edit/restart (ADR 080)

- Implemented ADR 080:
  - Copy the original Markdown of user and assistant messages.
  - Edit and restart a user message inline.
- Main owns eligibility and commit-time revalidation. Migration 0046 records replacements and
  pending-proposal invalidation. Raw events, traces, and usage remain, while the timeline, titles,
  and compaction read the effective history.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-08--agent-message-copy-and-editrestart-adr-080).

## 2026-09-08 Conversation fork

- Implemented conversation fork under ADR 081:
  - Migration 0047 adds provenance and flattened immutable event references without copying payloads.
  - Creation is idempotent and does no model work.
  - Inherited tool records appear only as historical Details.

### 2026-09-08 — Release 0.2026.9.4 preparation

- The user authorized complete tests, a local build, and publication of `0.2026.9.4` after the hosted
  build. Fork and message-edit scenarios joined packaged acceptance. Stale fixtures and races found by
  the package gate were corrected without weakening product assertions.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-08-conversation-fork).

## 2026-09-08 Release 0.2026.9.4 publication

- Published [WriteLLM 0.2026.9.4](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.4) from
  immutable tag `v0.2026.9.4` (`7bc4ff6`).
- The local package gate passed, along with Actions run `34171296372` on four platforms. Eleven assets were verified.
- Windows and Intel Mac evidence records `dirty` because native preparation creates untracked sqlite-vec
  resource directories there. The original evidence was preserved, not rewritten.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-08-release-0202694-publication).

## 2026-09-09 Editor save continuity and composition

- Repaired editor lifecycle and IME composition:
  - A stable editor is scoped to project session and section.
  - Saves update the persistence base without remounting or resetting undo history.
  - External content loads only into a clean, idle, non-composing editor; otherwise it becomes a conflict.
  - Composition defers autosave and rejects explicit flushes.
- Real macOS input-method switching remained manually unverified.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-09-editor-save-continuity-and-composition).

## 2026-09-09 Release 0.2026.9.5 preparation

- The user requested an App rebuild and publication of the next September sequence. Remote
  releases/tags confirm `0.2026.9.4` as latest and `v0.2026.9.5` as unused. Advanced
  `release.version` to `0.2026.9.5`, retaining SemVer base `0.2026.9`, and promoted the three
  editor continuity/composition/race scenarios to packaged acceptance.
- Follow the currently enabled tag-only four-platform build workflow and the preceding release
  procedure: full local Electron tests, local macOS arm64 package acceptance, immutable source
  tag, successful hosted builds, verified artifacts, then explicit unsigned GitHub Release.
  No signing/notarization or disabled promotion workflow is enabled by this maintenance.
- Frozen install passed without dependency changes. Full Electron-hosted tests passed
  **249 files / 1,440 tests**, with three benchmark files/tests intentionally skipped, in
  **25.23s** Vitest time. Evidence: `.cache/releases/0.2026.9.5/full-tests.log`.

## 2026-09-09 Release 0.2026.9.5 publication

- Published [WriteLLM 0.2026.9.5](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.5)
  from immutable tag `v0.2026.9.5` (`65a663f`), with the editor continuity repair.
- The local package gate and Actions run `34413270209` on four platforms both passed. Seven installers and four evidence
  files were verified before publication.
- Actual macOS IME switching remained manually unverified.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-09-release-0202695-publication).

## 2026-09-10 DeepSeek editor autocomplete

- Implemented the [ADR 082](../adrs/082-deepseek-autocomplete.md) DeepSeek editor autocomplete PoC:
  - One independent FIM/Autocomplete model selection reuses the built-in DeepSeek credential.
  - A session-scoped toolbar toggle.
  - Chat Prefix at block end and FIM inline.
  - A fixed beta origin, 128-token non-streaming requests, and no retries.
  - Decoration-only suggestions; Tab acceptance is one undoable insertion.
- `prosemirror-history` became an exact direct dependency.
- A live synthetic probe of `deepseek-v4-pro` and `deepseek-flash` succeeded 8/8. No private content was used.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-10-deepseek-editor-autocomplete).

## 2026-09-10 Autocomplete style dropdown

- ADR 082 amendment: one shadcn DropdownMenu combines the session toggle, the Words, Sentence, and Paragraph
  styles (persisted as `editor.autocomplete.style.v1`), and model settings.
  - Token budgets are style-specific, and ICU segmentation enforces display caps.
  - A style change invalidates pending suggestions.
- A live synthetic probe of `deepseek-flash` succeeded 12/12.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-10-autocomplete-style-dropdown).

## 2026-09-10 Autocomplete style App packaging

At the user's explicit request, rebuilt the macOS arm64 App with the completion style
menu. `pnpm check:package:smoke` passed in 83.5 seconds: static checks 11.2s, one build
11.6s, App packaging 20.7s, inventory/signature checks, and all 12 packaged runtime smoke
scenarios in 39.7s. Zero retries/skips. SQLite user_version 10 and integrity check passed;
all four process roles loaded, native modules were arm64, and credential/body/root leak
checks passed. Evidence: `.cache/verification/1789052845483-20238-2110b8c3/`.

Artifact: `dist/macos-arm64/mac-arm64/WriteLLM.app`, matching the current source and `out/`.
Source E2E coverage from the style implementation remains applicable; no full E2E rerun,
installers, release signing/notarization or publication. macOS arm64 only; existing host
Node 26 / declared Node 24 limitation remains, with Electron ABI 148 for native runtime.

## 2026-09-10 Continuous autocomplete and composition

- ADR 082 amendment for continuous autocomplete:
  - Tab accepts one suggestion and re-requests after 200 ms.
  - Matching typing consumes the suggestion locally.
  - Esc, undo, and empty results keep a quiet snapshot.
  - Composition hides and retains the candidate until verified committed insertion.
- Native candidate selection remained unverified after an attempted native IME probe.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-10-continuous-autocomplete-and-composition).

## 2026-09-10 Candidate 0.2026.9.6 source tag

The user requested the next 9.x version tag. The existing highest local tag was
`v0.2026.9.5`; the next candidate is `v0.2026.9.6`, with `package.json` release.version
updated to `0.2026.9.6` and the three-component package version retained as `0.2026.9`.
The candidate commit includes the previously verified DeepSeek autocomplete PoC,
style selection, continuous completion and composition handling documented above.
An annotated local tag records that source; remote push and publication are outside
this operation.

Verification reuses the unchanged implementation's 65 focused tests, four affected
Electron scenarios, 12 packaged smoke checks and final packaged autocomplete scenario.
The metadata-only update passed the release metadata resolver (macOS build `2026.9.6`),
Biome across 811 files in 342ms and `git diff --check`, with no retries. No application
build or functional tests were repeated. The existing App retains the earlier build
number and is not a newly packaged 0.2026.9.6 artifact. Existing macOS-only runtime,
real system-IME and Node 26 versus declared Node 24 limitations remain unchanged.

## 2026-09-13 Brief and Outline preview

- The Preview workspace gained Brief and Outline destinations next to Markdown. Each has a complete plain-text copy
  projection, and internal IDs are excluded. Renderer only.
- `min-w-0` fixes stopped long content from widening the workspace.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-13-brief-and-outline-preview).

## 2026-09-13 Brief and Outline preview App build

The user requested a local App to use the new previews. `pnpm package:unpack` built
`dist/macos-arm64/mac-arm64/WriteLLM.app` with release metadata `0.2026.9.6`, including
the current uncommitted preview changes. The first sandbox invocation failed after 55.5s
when electron-builder could not resolve GitHub. The same command outside the sandbox
passed all four build-only stages in 33.5s: production build, App packaging, signature
policy and ASAR/resource/native inventory. The no-Team-ID ad-hoc/linker signature and
arm64 native modules passed inventory checks. Report:
`.cache/verification/1789330018726-29484-aad157ca`.

The App was opened for use. Existing source functional evidence remains applicable;
this request did not repeat functional suites or packaged runtime verification and did
not create installers or publish a release. Host Node 26.8.2 versus declared Node 24
remains unchanged; pnpm 11.17.0 and Electron 43.4.1 / ABI 148 were used.

## 2026-09-14 Autocomplete application defaults and temporary overrides

- ADR 082 amendment:
  - Saved application defaults: auto-enable (`editor.autocomplete.enabled.v1`) and length.
  - Main-owned temporary enabled and style overrides for the application lifetime, with Restore defaults.
- No schema migration.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-14-autocomplete-application-defaults-and-temporary-overrides).

## 2026-09-14 Release 0.2026.9.7 preparation

The user authorized building the App, tagging the next September version and publishing
a release. Version 0.2026.9.7 follows local candidate .6 and published .5; it includes
DeepSeek autocomplete, application defaults/temporary overrides and Brief/Outline previews.
The existing unsigned four-platform tag build and explicit GitHub Release publication
remain the distribution path. Signing and notarization are not introduced.

Frozen install passed with pnpm 11.17.0. The complete Electron invocation covered 1,533
tests: 1,529 passed, three benchmark skips and one test-reporting subprocess timeout at
5 seconds (31.1s runner). The affected scripts/test-reporting.test.ts passed both tests
on focused rerun in 1.9s without code changes. Thus 1,530 distinct tests are covered by
passing results, with the initial harness timeout retained as evidence. Reports:
.cache/verification/1789393546638-53832-5c2c980a/ and
.cache/verification/1789393594976-54562-8c21f72e/. Recovery inventory passed 32 cases.
Local full package acceptance and hosted build/publication results will be recorded
after they complete, without altering the immutable release tag.

## 2026-09-14 Release 0.2026.9.7 publication

- Published [WriteLLM 0.2026.9.7](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.7)
  from immutable tag `v0.2026.9.7` (`5535110`), with autocomplete defaults, overrides, and Brief/Outline
  preview.
- The local package gate passed, along with Actions run `34851835641` on four platforms. Eleven assets were verified.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-14-release-0202697-publication).

## 2026-09-17 Model-service HTTP endpoints

- User-authorized maintenance allows Agent, Embedding, and Rerank Base URLs to use HTTP or
  HTTPS with domains, IPv4, or IPv6. MinerU retains its existing HTTP host restrictions and
  artifact URL policy. URL length, normalization, embedded-credential/query/fragment rejection,
  encrypted credential origin binding, and existing structured configuration lifecycle logs remain.
  The Agent form now says `Use HTTP or HTTPS.` No migration, dependency, packaging, or release change.
- Final-source focused coverage is 66 passing tests across provider contracts, provider service,
  Agent catalog, and provider IPC. The first invocation took 3.9s and exposed one obsolete IPC
  HTTP-rejection expectation; its corrected eight-test IPC rerun passed in 0.8s. The other 58
  passing tests remain applicable. Coverage includes HTTP save/reload, all three model roles,
  MinerU policy preservation, and credential invalidation on protocol or host changes.
- The targeted `check:e2e` invocation passed formatting/lint, both typechecks, native loading,
  and one production build. Two E2E attempts exposed mistakes in the added test flow (a check
  before preset creation, then an unnecessary Back action after reopening Settings). After test-only
  corrections, the same built App passed `app.provider-settings-persist-without-secret` in 10.7s
  (11.3s wrapper), zero retries/skips. It saves a reserved `.test` HTTP domain in the UI and verifies
  it after app restart without contacting that domain. The user-supplied endpoint is only a schema
  fixture and was not contacted. Updated test formatting and Main typechecking also passed.
- Reports: `.cache/verification/1789681428027-42972-6b138c16/` (initial focused tests),
  `.cache/verification/1789681457046-43244-3a8c7f4b/` (IPC rerun),
  `.cache/verification/1789681443143-43189-ce0d7d8a/` (static/build and initial E2E),
  `.cache/verification/1789681515034-43544-75735ba2/` (second E2E), and
  `.cache/verification/1789681568512-43666-bcc9c5b7/` (passing E2E).
  Runtime evidence is macOS arm64, Electron 43.4.1 ABI 148; pnpm 11.17.0 matches the manifest.
  Host Node 26.8.2 remains outside the declared Node 24 range. Other platforms and packaged
  artifacts were not tested; the existing packaged App has not been updated.

## 2026-09-17 HTTP endpoint App build

- User requested an App build after the endpoint change. `pnpm package:unpack` produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app` with the HTTP endpoint implementation, retaining
  release metadata `0.2026.9.7`. No installers, publication, or version change were requested.
- The first sandboxed packaging attempt encountered `github.com` DNS denial and was stopped.
  The same command outside the sandbox passed in 30.0s: production build, App packaging,
  no-Team-ID ad-hoc/linker signature policy, and ASAR/resource/native inventory (arm64
  better-sqlite3 and sqlite-vec). Report:
  `.cache/verification/1789681661580-44238-15946026/`.
- This was a build-only invocation; prior focused source tests remain the functional evidence.
  No packaged runtime tests or installers were run, and the App remains unnotarized.

## 2026-09-17 Model-service HTTP request policy correction

- Real App logs showed `agent.model_catalog.refresh_failed` with `configured_url_invalid`:
  configuration validation allowed HTTP, but `fetchConfiguredEndpoint` still rejected remote HTTP
  before sending a request. The earlier save/restart E2E did not cover this network boundary.
- Added an explicit model-service request policy for custom Agent catalog refresh and
  Agent/Embedding/Rerank probes. The default remains loopback-only HTTP for existing MinerU
  callers. Redirect rejection, URL credential/fragment checks, bounded bodies, and existing
  structured error logging remain intact. No credential, migration, or artifact policy changes.
- Focused Electron tests pass 48 cases across outbound policy, catalog discovery/cache,
  provider probes, and MinerU requests. These assert fetch invocation and model parsing for
  remote HTTP rather than configuration acceptance alone. Initial tests took 4.1s and caught
  an invalid MinerU model in the new fixture; after correcting that fixture, all 14 probe
  tests passed in 0.8s, reusing the other 34 passing cases. No real user endpoint was contacted.
- `check:fast` passed in 11.1s; final fixture formatting passed separately. `package:unpack`
  rebuilt the macOS arm64 App in 31.7s with native inventory and signature-policy checks,
  preserving release metadata `0.2026.9.7`. Reports:
  `.cache/verification/1789682702208-45713-91c9e34f/`,
  `.cache/verification/1789682726256-45959-4af0adb2/`,
  `.cache/verification/1789682714946-45923-04ddc6f6/`, and
  `.cache/verification/1789682730494-46018-a9121848/`.
- The same App passed all 12 packaged runtime smoke categories in 39.5s without retries,
  including native modules, all worker roles, credential storage, HTTP provider fallback,
  security boundaries, logging redaction, and database integrity. Report:
  `.cache/verification/1789682774866-46444-2218e3c4/`.
  Artifact: `dist/macos-arm64/mac-arm64/WriteLLM.app`. Runtime coverage is macOS arm64 with
  Electron 43.4.1 ABI 148; host Node 26.8.2 remains outside the declared Node 24 range.
  No installers, release publication, other-platform tests, or real endpoint validation.

## 2026-09-19 Keyboard shortcut separation

- Removed the shared Mod+B sidebar and Mod+J workspace bindings.
- One Renderer-local command definition now supplies matching and labels to listeners, Settings, menus,
  and hints. Matching is strict on modifiers, composition- and repeat-aware, and handles macOS Option symbols.
- No IPC or persistence change.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-keyboard-shortcut-separation).

## 2026-09-19 Tabbed docking workbench

- Implemented ADR 083's tabbed docking workbench on Dockview React 8.3.1:
  - Unique content tabs keep their editor state.
  - Dockable tool groups.
  - Independent Notebook instances, at most ten per project.
  - Shared Main admission of three Agent/Notebook runs, superseding ADR 074's removal.
- Versioned per-project layout settings live in app.sqlite under sender and session authorization.
  Navigation flushes retained editors.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-tabbed-docking-workbench).

## 2026-09-19 Layout menu

- Moved Reset layout and tool and content visibility checkboxes into the global Menubar, in the order
  `Project / Edit / Layout / Tools`, and removed the reset toolbar.
- A Renderer-only bridge publishes the actual Dockview membership.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-layout-menu).

## 2026-09-19 Workbench scrollbar theme

- Corrected the black native scrollbar on the light workbench. Dockview's internal
  `dv-shell dockview-theme-abyss` owns a dark color-scheme and renders content in sibling
  portals; setting the external React wrapper alone did not reach the scrolling editor.
  A workbench-scoped shell rule now selects light native controls, with the existing `.dark`
  application theme selecting dark controls. No scroll geometry or persistence changes.
- Static checks passed in 11.7s (`1789811471239-72434-78ac12b3`); final formatting/diff checks
  passed. Initial visual verification showed the wrapper-only correction was insufficient;
  a diagnostic run inspected computed ancestor styles, then the final selector was verified
  with an actual scroll-container color-scheme assertion and desktop screenshot. The existing
  workbench E2E passed in 11.9s with zero retries/skips
  (`.cache/verification/1789811622906-74548-7eb333d8/`). No new test scenario was added.
- Rebuilt `dist/macos-arm64/mac-arm64/WriteLLM.app`; final build, signature policy and package
  inventory passed in 32.9s (`.cache/verification/1789811603014-74079-9a3f20e1/`). One earlier
  package preceded discovery of the nested shell. Final E2E reused the final package build's
  source output. macOS arm64 only; no packaged functional suite or dark-mode visual acceptance.

## 2026-09-19 Workbench status bar

- Added a fixed 28 px project status bar:
  - Index readiness.
  - An AI menu for live Agent work and Notebooks.
  - Autocomplete controls.
  - Saved word counts.
- The shell now owns Knowledge job observation. No IPC or migration change.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-workbench-status-bar).

## 2026-09-19 Status-bar App rebuild

- The user requested a runnable App containing the status bar. `pnpm package:unpack` produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app` with release metadata 0.2026.9.7 from the current
  dirty working tree. The no-Team-ID signature policy and ASAR/resource/native inventory passed
  (34,023 ASAR entries, arm64 better-sqlite3/sqlite-vec, Electron 43.4.1 / ABI 148).
- The initial build reached packaging but sandbox DNS blocked github.com; it was interrupted
  after 57.2s. The identical command outside the sandbox passed all four build stages in 33.2s.
  Successful report: `.cache/verification/1789813222772-87547-4e2554ec/`.
- Additional packaged runtime smoke verified native hybrid FTS/vector loading. The first attempt
  then hit sandbox loopback EPERM; the same smoke outside the sandbox also passed the credential
  backend check but failed during comment creation with
  `Manuscript mutation editor flush revision was not acknowledged` (3.4s).
  Report: `.cache/verification/1789813277935-88308-10e3476a/`.
  This is a build-only App with partial runtime evidence, not a passed complete package gate.
  No installer, release publication, commit or push was performed.

## 2026-09-19 Notebook source capacity

- Removed Notebook's fifty-source selection cap, amending ADR 058. Selectable capacity is now distinct
  from bounded retrieval, citations, and context.
- SQL source membership uses one JSON-array binding with `json_each`, shared by FTS and vector filters.
- Index availability is shown independently of selection.
- A 301-PDF real-chain E2E scenario was added.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-notebook-source-capacity).

## 2026-09-19 Release 0.2026.9.8 preparation

- Candidate `0.2026.9.8` includes:
  - ADR 083's Dockview shell and Notebooks.
  - The Layout menu and status bar.
  - Scrollbar theming.
  - The Notebook source capacity change.
- Three package-gate attempts exposed two product defects, which were fixed:
  - Retained-editor flush routing.
  - Duplicate Agent activity deliveries, now isolated by subscription ID.
  The attempts also exposed stale pre-Dockview test assumptions. No failed candidate was pushed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-release-0202698-preparation).

## 2026-09-19 Release 0.2026.9.8 publication

- Published [WriteLLM 0.2026.9.8](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.8)
  from immutable tag `v0.2026.9.8` (`65a380b`).
- The final clean-source package gate passed, along with Actions run `35440017115` on four platforms. Eleven
  assets were verified before and after publication.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-release-0202698-publication).

## 2026-09-19 Empty-workbench navigation

- Navigating to the manuscript from an empty content group now opens Outline instead of failing.
- Citation insertion creates pending state only after successful section activation.
- Asset navigation selects its section directly.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-empty-workbench-navigation).

## 2026-09-19 Tool sidebar layout

- Tool close controls moved into the tab headers.
- Removed repeated project headers, the Active badge, and tool completion footers. The status bar shows one
  saved completed/total section count.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-19-tool-sidebar-layout).

## 2026-09-19 Sidebar layout App build

- Built the current working tree, including tool sidebar layout and empty-workbench navigation,
  with the user-requested `pnpm package:unpack`. Output:
  `dist/macos-arm64/mac-arm64/WriteLLM.app`, version 0.2026.9.8 / build 2026.9.8.
- The sandbox attempt compiled successfully but packaging failed on `ENOTFOUND github.com`
  after 55.2s. Retrying the same command outside the sandbox passed all four build-only stages
  in 32.5s: production build, App packaging, signature policy and package inventory. Electron
  43.4.1 ABI 148 and both native libraries were confirmed arm64; the App has the permitted
  no-Team-ID ad-hoc/linker signature and is not notarized. No installers or publication requested.
- Report: `.cache/verification/1789822544928-56798-fe66f983/`; failed sandbox report:
  `1789822477951-56146-a610fe6f/`. This was build-only, with no repeated application tests or
  packaged runtime smoke. Prior source runtime evidence remains recorded above.

## 2026-09-19 Tag-only 0.2026.9.9

- The user requested a new version tag without a Release. Recorded current sidebar-layout and
  empty-workbench navigation changes in source, advanced only `package.json#release.version`
  to 0.2026.9.9 (package base stays 0.2026.9), and created local annotated tag `v0.2026.9.9`.
  No remote push, hosted build, installer publication or GitHub Release is included.
- Reused the source static/Electron evidence and macOS arm64 App-build evidence above. The existing
  App includes these functional changes under 0.2026.9.8 metadata; this source-only tag does not
  claim a 0.2026.9.9 binary or new packaged runtime acceptance.
- Tag preparation checks: frozen install passed without lockfile changes; package metadata
  resolution, Biome and diff checks passed. Existing functional verification was reused because
  this step changes only release metadata and documentation.

## 2026-09-19 Section title typography

- Corrected the section title Textarea's desktop font override: shared `md:text-sm` had
  overridden its existing `text-3xl`. The title now uses `md:text-3xl` too, retaining 30px
  semibold typography, content-driven wrapping, and the existing editing/save behavior.
- `pnpm check:fast` passed all three stages in 12.0s (833 files checked; both typechecks),
  with zero retries. The typography detector returned no findings; a direct tailwind-merge
  check confirmed that the title classes remove the shared 14px desktop default.
  Report: `.cache/verification/1789826932529-84765-83201381/`.
- pnpm 11.17.0 matches the project pin; host Node 26.8.2 emitted the existing engine-range
  warning. This style-only change required no interaction tests, build, or packaged gate;
  rendered runtime appearance was not inspected. Existing `out/` and the local App predate it.

## 2026-09-21 macOS native menu

- ADR 084 consolidated the macOS-only native menu:
  - Main owns fixed native menus, validated state and command contracts, and current-window and session authorization.
  - Renderer callbacks keep the existing workflows.
  - Native shortcuts share the Main dispatcher and are not dispatched twice.
- Other platforms keep the in-window shadcn Menubar.
- Local App built at `0.2026.9.9`.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-21-macos-native-menu).

## 2026-09-25 Anti-Defensive Writing catalog

- Added the Chinese `anti-defensive-writing` and English `anti-defensive-writing-en` entrypoints
  from [Adkid-Zephyr/anti-defensive-writing-Skill](https://github.com/Adkid-Zephyr/anti-defensive-writing-Skill)
  to the curated metadata catalog. Both use reviewed commit
  [`102c8b2`](https://github.com/Adkid-Zephyr/anti-defensive-writing-Skill/commit/102c8b21acf5eda3a0aef3d9779a65db646c8980),
  MIT attribution, exact byte sizes and Git blob hashes. The upstream skill directories contain
  only their `SKILL.md` entrypoints; no third-party bodies were bundled. Users install either
  language on demand through the existing Main-owned downloader.
- Reviewed both entrypoints. They focus on claim and evidence alignment but also advise against
  highlighting unfavorable results. Application safety, truthfulness, citation, and evidence
  rules remain higher priority; the catalog descriptions reflect evidence-backed use. The
  upstream folded YAML descriptions exposed a trailing-newline difference between the local YAML
  parser and Pi. The comparison now trims Pi's description at that boundary; a permanent
  folded-description installation test covers it.
- Verification: `pnpm check:fast` passed Biome and both typechecks in 11.7s, after correcting
  one catalog formatting issue (report `.cache/verification/1790349520027-26346-1f437f5a`).
  Four focused Electron test files passed 14 tests in 1.4s with zero retries (report
  `.cache/verification/1790349505414-26269-26b594a2`). A temporary test checked both exact
  upstream byte counts and blob hashes and compared local/Pi parsing. Its first run identified
  the folded-description mismatch; after the comparison was normalized, it passed for both
  entrypoints in 0.9s. The temporary test was removed. Host Node 26.10.0 remains outside the
  declared Node 24 range; pnpm 11.17.0 matches the pin. No E2E, package build, live GitHub
  install, or other-platform verification was run for this catalog and parser change.

## 2026-09-25 Anti-Defensive Writing App build

- At the user's request, rebuilt the macOS arm64 unpacked App at
  `dist/macos-arm64/mac-arm64/WriteLLM.app` using `pnpm check:package:smoke`. The completed gate
  passed static checks, native preparation, production compilation, unpacked packaging,
  permitted no-Team-ID ad-hoc/linker signature verification, resource/native inventory and all
  12 packaged runtime smoke scenarios. It took 86.2s across six stages; report:
  `.cache/verification/1790349868040-27054-f93fa0d9`.
- Directly inspected `out/main/index.js` inside the resulting ASAR and confirmed both
  Anti-Defensive Writing catalog IDs and the exact upstream commit pin. The App uses release
  metadata `0.2026.9.9`, Electron 43.4.1 / ABI 148, arm64 `better-sqlite3` and `sqlite-vec`.
  No installer, signed release or publication was requested. The installed Writing Skills in a
  user's app data remain separate from this bundled catalog.
- The first sandbox invocation passed static checks and compiled but hit `ENOTFOUND github.com`
  while electron-builder fetched packaging resources. That attempt was stopped after the clear
  DNS failure; the same gate passed once with host network and GUI authority. No test scenario
  retries occurred in the completed gate. Host Node 26.10.0 is outside the project's declared
  Node 24 range; pnpm 11.17.0 matches the pin. Windows/Linux were not run.

## 2026-09-26 Tool-close sizing

- Closing a tool no longer enlarges the surviving side tools. This fixed a 276 px regression from
  Dockview's sibling-order relayout. One shared removal path temporarily caps the surviving groups'
  widths beside the content, then restores them.
- Added the `workbench.close-sizing` scenario.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-26-tool-close-sizing).

## 2026-09-26 Tool-close sizing build and local integration

- The user subsequently authorized a final build, commit and merge into the local main branch,
  superseding the earlier no-commit scope; remote publication remains outside scope.
- `pnpm build` passed native load preparation and production compilation in 11.8s against the
  final implementation. Report: `.cache/verification/1790409834516-41051-2feb4c31/`.
  The renderer output hash matches the previously tested build (`index-wdGvyRhV.js`);
  static checks and the three passing Electron scenarios above still cover the final source.
- Main checkout inspection found a clean `main` at `a5a20ab`, the fix's exact base, permitting
  a fast-forward integration without reconciling or replacing other work. Delivery uses the
  scoped `codex/preserve-sidebar-widths` branch. No packaged App, installer or remote push is
  part of this source-build and local-integration request. Host/runtime limits remain as above.

## 2026-09-26 Release 0.2026.9.10 local acceptance

- Release `0.2026.9.10` local acceptance. The release policy now records the unsigned tag-only
  four-platform build with manual publication.
- The first package gate exposed one native-menu defect: Layout checkboxes now keep the
  last confirmed state until the Renderer succeeds. It also exposed three stale fixtures. The final
  `check:package` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-09-26-release-02026910-local-acceptance).

## 2026-09-26 Server-side four-package publication

- The user explicitly replaced the local download/re-upload release step with GitHub-hosted
  publication, so delivery no longer requires a local computer to remain online. This supersedes
  the manual-publication policy recorded earlier today. No existing tag is moved or rebuilt.
- Added `publish-release.yml`: successful tag-build completion triggers publication; manual
  dispatch accepts a successful build run ID plus its existing tag for continuation. `ci.yml`
  remains tag-only and read-only. The separate publisher alone receives `contents: write`.
- Publishing executes trusted default-branch code, validates same-repository fixed-workflow
  provenance, tag SHA/version/default-branch ancestry, successful four-platform jobs and selected
  artifact metadata/hashes. Artifact data is isolated under runner temporary storage and never
  executed. A draft gets exactly four packages (Windows EXE, both macOS DMGs, Linux AppImage),
  is checked against uploaded digests, then becomes a normal non-prerelease release. Existing
  mismatched assets fail closed; matching drafts can resume without clobbering files.
- Release 0.2026.9.10 notes retain actual local test results, the native-menu fix, initial failure
  history and platform/signing limits. JSON evidence and alternative archives remain in CI.
  Implementation validation is limited to script syntax/style, workflow YAML/trigger/permission
  checks and read-only source-run validation; no application tests or platform builds are rerun.
  Deployment and remote publication are recorded separately after they occur.

## 2026-09-26 Publisher source-check correction

- Source CI [36231039256](https://github.com/ecwu/writellm/actions/runs/36231039256) completed
  successfully on all four native platforms. Deployed publisher run
  [36231883009](https://github.com/ecwu/writellm/actions/runs/36231883009) then failed before
  artifact download or Release writes: the repository-root API helper emitted a trailing slash,
  and GitHub returned HTTP 404. The original log is retained locally.
- Removed the extra slash for empty API paths. Node syntax and Biome checks pass; the complete
  read-only `--plan` now verifies the actual successful run, tag SHA/version/default-branch
  ancestry, platform jobs and artifact identities. Server-side continuation reuses that same
  successful run and immutable tag; no application test or platform build is repeated.

## 2026-09-26 Publisher AppImage filename correction

- Continuation [36231968251](https://github.com/ecwu/writellm/actions/runs/36231968251) passed
  the full source check and the first three package checks, then stopped before Release writes
  because the Linux selection expected `x64.AppImage`. The established package inventory and
  original Linux evidence use `x86_64.AppImage` (while the native target remains `linux-x64`).
- Corrected only that filename suffix. All four selected naming conventions were compared with
  retained native build evidence; Node syntax, Biome and diff checks pass. No artifact was newly
  downloaded locally and no application test or platform build was repeated. The continuation
  still reuses source run 36231039256 and immutable tag v0.2026.9.10.

## 2026-09-28 Publisher draft recovery correction

- Continuation [36232094160](https://github.com/ecwu/writellm/actions/runs/36232094160)
  passed source provenance and all four package checks. It created the `WriteLLM 0.2026.9.10`
  draft, then failed before uploading any package: GitHub exposed the draft under an
  `untagged-…` API name, while the publisher searched only for `v0.2026.9.10`.
- The publisher now finds a single matching draft by exact title and notes, refuses modified or
  ambiguous drafts, uploads by the draft's current API name, and explicitly sets the verified
  release tag when publishing. Three focused state tests, script syntax, Biome, and diff checks
  validate the local correction. The immutable source build and tag remain unchanged. Deployment,
  continuation and publication are recorded when they occur.

## 2026-09-28 Release 0.2026.9.10 publication

- Deployed publisher repair commit `634b0ebf504dc30d156d5e90d0337ecbf585a2f0` to `main`.
  Manual continuation [36407814763](https://github.com/ecwu/writellm/actions/runs/36407814763)
  succeeded in 1m 13s using successful source run 36231039256 and immutable
  `v0.2026.9.10` at `7bd202bcef9193180a83edf65cdcb7eb282361d0`. No source rebuild or
  tag movement occurred.
- [WriteLLM 0.2026.9.10](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.10)
  was published at 2026-09-28 10:09:03 UTC as a normal Latest Release. GitHub reports exactly
  four uploaded packages: Windows x64 EXE, macOS arm64 DMG, macOS x64 DMG, and Linux x64
  AppImage. The publisher compared all four uploaded sizes and SHA-256 digests with the original
  package evidence before making the draft public; a read-only public API check independently
  confirmed those four uploaded assets, non-draft/non-prerelease state, and Latest status.
  Distribution remains unsigned and macOS packages are not notarized.

## 2026-10-02 Pi 1.0.0 upgrade

- [Issue 1](https://github.com/ecwu/writellm/issues/1) upgraded Pi to exact `1.0.0`:
  - WriteLLM now owns the Skill shape and its parsing through the existing verified YAML parser.
  - Worker `prepareRequest` applies steering and follow-ups.
  - `finishTurn` ends output-limit responses.
  - Catalog adapters accept chat models only.
- Architecture and ADRs 008, 013, 053, 074, and 076 were amended.
- `check:full` and `check:package` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-pi-100-upgrade).

## 2026-10-02 Pi 1.0 integration authorization

- The user authorized committing and pushing the accepted Pi 1.0 change to remote `main`, then closing Issue 1.
  Local `main` and fetched `origin/main` share the same starting commit, `a7450ac`.
  The final source retains the full and package acceptance results recorded above.
  Only documentation changed after those gates, and final Biome, diff, and local evidence-link checks passed.
  This integration does not publish a release or change CP77.

## 2026-10-02 dependency security and maintenance refresh

- ADR 056 amendment: updated 30 direct dependencies, including Electron 43.7.7, Playwright 1.63.0,
  and Vitest 4.1.11. Security overrides repaired fast-uri, brace-expansion, undici, js-yaml, DOMPurify, and tar.
- Pinned Node 24.21.0 and pnpm 11.28.3.
- Unified ProseMirror View and Model versions after the package gate exposed duplicate Model classes.
- Both audits went to zero advisories, and `check:package` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-dependency-security-and-maintenance-refresh).

## 2026-10-02 Issue 2 first-stage dependency update

- First stage of [Issue 2](https://github.com/ecwu/writellm/issues/2) (ADR 056 amendment): Citation.js core and
  plugins went to 0.9.0, thinking-orbs to 0.3.2, and `@types/better-sqlite3` to ^9.6.0.
- Citation.js 0.9 switched to global `fetch`. A Main build plugin now replaces its fetch utility
  with the existing network-denied module, preserving ADR 034's no-network parsing.
- A runtime probe found the CSL plugin missing from the bundle, and it was added. The final `check:package` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-issue-2-first-stage-dependency-update).

## 2026-10-02 Issue 2 first-stage acceptance rerun

- The acceptance rerun of the final first-stage source passed the complete Electron suite and `check:package`.
- Issue 2 was updated to mark the first-stage groups complete.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-issue-2-first-stage-acceptance-rerun).

## 2026-10-02 Issue 2 second-stage dependency migration

- Second stage of Issue 2: Kysely 0.29.6, BlockNote 0.55.0 (with its popup patch kept), and Vitest 5.0.3.
- BlockNote's floating UI move exposed an unreleased comment-creation mutation barrier. The comments
  panel now releases it in `finally`.
- Package acceptance passed. The first-stage commit is `de3f758`. Issue 2 was updated.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-issue-2-second-stage-dependency-migration).

## 2026-10-02 Issue 2 independent TypeScript migration

TypeScript advances from 5.9.3 to 7.0.2 under the independent migrations amendment.
Renderer paths use explicit relative targets without baseUrl.
The package retains a Node CLI wrapper, so canonical verification commands need no replacement.
Frozen installation passes with pnpm 11.28.3.
The three-stage static gate passes in 3.0s, including Main and Renderer typechecks.
Report: `.cache/verification/1790950813624-16536-6fab317b`.
Final build evidence will follow the shared matching package build.

## 2026-10-02 Issue 2 independent Mermaid migration

Mermaid advances from 11.17.2 to 12.1.0.
The renderer selects Dagre and classic appearance explicitly in both themes.
Strict SVG-only rendering, cleanup, and source-based exports retain their boundaries.
Frozen installation passes. Two focused files pass 15 tests in 0.35s with zero retries.
Report: `.cache/verification/1790950842950-17039-d3b333e0`.
Packaged diagram, theme, source recovery, and export evidence will follow the final matching build.

## 2026-10-02 Issue 2 independent native database migration

better-sqlite3 advances from 12.11.1 to 13.0.3 with Node-API binaries.
Native preparation and package inventory follow the package loader order: target prebuild, Debug, then Release.
The obsolete V8 warning workaround is removed. Source rebuild requests force compilation.
Nine focused files pass 47 tests in 3.22s with zero retries under Electron 43.7.7.
Report: `.cache/verification/1790950904428-17991-37937264`.
Native loading and sqlite-vec integration pass with the bundled darwin-arm64 binary.
The final Electron 44 suite and package gate will cover backup, recovery, integrity, and worker execution.

## 2026-10-02 Issue 2 independent Electron migration

Electron advances from 43.7.7 to 44.5.1.
Package metadata and README declare macOS 13 as the minimum for arm64 and x64.
The official 44 changes remove external ANGLE libraries; WriteLLM does not reference them.
The configured CI targets remain supported 64-bit platforms.
Clipboard test probes already await results, and product code uses navigator.clipboard.
No application use of removed Unity or login-item APIs requires changes.
The host Node 26.10.0 remains outside the declared Node 24 range and is preserved.
Electron embeds Node 24.21.0, ABI 149, and Node-API 10.
Native preparation passes in 0.3s with the same bundled Node-API binary and sqlite-vec.
Report: `.cache/verification/1790951000104-19610-e0cc3a45`.
Frozen installation passes with pnpm 11.28.3.
Production audit covers 747 packages, and the complete audit covers 1,181 packages. Both report zero known vulnerabilities.
The complete Electron suite passes 1,644 tests across 267 files in 20.92s, with three optional benchmark skips and zero retries.
Report: `.cache/verification/1790951001168-19697-35743db1`.
The suite includes the new binary resolver tests, backup, project snapshots, migrations, workers, exports, and editor contracts.
The package gate is running on macOS arm64. Other platform acceptance remains pending.

Official sources: [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/),
[Mermaid 12 defaults](https://github.com/mermaid-js/mermaid/blob/develop/docs/syntax/flowchart.md),
[better-sqlite3 13](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0),
and [Electron 44 changes](https://github.com/electron/electron/blob/v44.5.1/docs/breaking-changes.md).
The reviewed Mermaid parser and release are explicit minimum-age exceptions added by pnpm.

## 2026-10-02 Issue 2 independent migrations final acceptance

- Final acceptance of the independent Issue 2 migrations passed `check:package` on macOS arm64:
  - TypeScript 7.
  - Mermaid 12.
  - better-sqlite3 13 on Node-API.
  - Electron 44 with macOS 13 as the minimum.
- The developer guide now describes Node-API loading. Issue 2 stayed open pending the other platforms.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-issue-2-independent-migrations-final-acceptance).

## 2026-10-02 Release 0.2026.10.1 preparation

- Package base `0.2026.10`, release `0.2026.10.1`. The tag-only build and the successful-workflow server-side
  publisher are active and publish four assets: Windows EXE, two macOS DMGs, and Linux AppImage.
- Tag `v0.2026.10.1` points to `1eb808e`. Build `37022616070` passed.
- The publisher failed once because an immediate list read missed the new draft. Correction `8b273fa`
  consumes the creation response. Attempt 2 then published
  [WriteLLM 0.2026.10.1](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.1).

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-02-release-02026101-preparation).

## 2026-10-03 Issue 3 Agent image input

- Implemented [Issue 3](https://github.com/ecwu/writellm/issues/3) under [ADR 085](../adrs/085-agent-image-input.md),
  covering persistent Agent image input:
  - Up to four PNG, JPEG, or static WebP attachments per message.
  - Photon 0.3.4 decoding in the background worker.
  - Originals and sending copies under `.writellm/agent-attachments/`, with migration 0048.
  - A separate 32 MiB history image budget.
  - Hash-only trace projection.
- `pnpm test` and `check:package` passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-03-issue-3-agent-image-input).

## 2026-10-03 Agent image presentation refinement

- Refined image presentation under ADR 085:
  - 80 px composer thumbnails.
  - Proportional history images up to 160 px, shown above the text bubble.
  - 64 px queued thumbnails.
  - Metadata in tooltips.
- Renderer only. The unpacked App was rebuilt.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-03-agent-image-presentation-refinement).

## 2026-10-05 Conversation search timestamps

Conversation search rows show elapsed time since `updatedAt` instead of repeated workflow status.
The labels use `now`, `m`, `h`, `d`, `w`, `mo`, and `y` with whole elapsed units.
Each row exposes its full local timestamp through the native hover title and semantic `time` element.
Existing attention groups, status icons, search matching, and conversation actions remain unchanged.

Verification selects `pnpm check:fast` because this maintenance changes only Renderer text presentation.
All three static stages pass in 2.8s across 864 Biome files and both TypeScript targets.
One earlier attempt fails the accessibility lint rule for an unsupported `aria-label` on `time`.
The final source uses screen-reader text and passes the repeated gate.
Report: `.cache/verification/1791196067321-89871-10cf1588`.
`git diff --check` passes. No application build or runtime tests run for this text change.
The sandbox pnpm wrapper stays silent during version selection, so the gate uses approved host access.
The host uses pnpm 11.28.3 and Node 26.10.0. The project declares Node 24.x.
Runtime behavior on other platforms remains untested for this maintenance.

## 2026-10-05 Default tool tabs

- Left tools now open as tabs in the closest existing eligible left group. Agent keeps its right group.
  Saved layouts and manual splits are preserved.
- ADR 083 records the rule. No schema or IPC change.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-05-default-tool-tabs).

## 2026-10-05 Tool tabs App rebuild

The user requests a code push followed by a new local App build.
Commit `715f687563a3ce128983c845344a4f8168c91c64` includes default tool tabs and the existing conversation timestamp presentation.
The push to `origin/main` succeeds before the build. The source tree is clean at build time.

`pnpm package:unpack` passes four build and inventory stages in 40.1s on macOS arm64.
Production compilation takes 17.0s. App packaging takes 23.0s.
Signature policy and package inventory both pass. The App retains its permitted no-Team-ID ad-hoc/linker signature.
The inventory contains 34,434 ASAR entries and arm64 binaries for better-sqlite3 and sqlite-vec.
The runtime is Electron 44.5.1, ABI 149, with better-sqlite3 13.0.3 and sqlite-vec 0.1.9.
The host uses pnpm 11.28.3 and Node 26.10.0. The declared Node range remains 24.x.
Report: `.cache/verification/1791197292618-2395-ece64d0c`.

The App is `dist/macos-arm64/mac-arm64/WriteLLM.app`.
Its Info.plist declares package version 0.2026.10 and build number 2026.10.1. Release metadata remains 0.2026.10.1.
This build runs no functional tests. The preceding static and three-scenario source acceptance remains applicable.
No version increment, installer, tag, hosted build, or release publication runs.

## 2026-10-14 Issue 16 legacy citation conversion

- Implemented [Issue 16](https://github.com/ecwu/writellm/issues/16), legacy citation conversion, under ADR 070:
  - Main commits revisions synchronously, then materializes each through `EditorPersistenceService`.
  - Partial failures report the committed count and pending mirrors (`reference.legacy_conversion.materialization_pending`).
  - Session authorization is rechecked during publication.
  - Retention cleanup is shared through `pruneRevisionBodies`.
- Renderer messages distinguish partial conversion from expiry.
- Claude review accepted the change. It was committed and pushed, and Issue 16 was closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-issue-16-legacy-citation-conversion).

## 2026-10-14 Issue 5 Agent tool definition cleanup

- Issue 16 was pushed as `e477e9a`.
- [Issue 5](https://github.com/ecwu/writellm/issues/5) removed 15 unused Worker TypeBox parameter exports,
  the commented registry, and the `AgentReadToolBridge` alias. `agent-tools.ts` went from 1,066 to 215 lines,
  and the active bridge is byte-for-byte unchanged.
- Tests now inspect the authoritative shared Zod schemas, including minimum argument fixtures for all 22 tools.
- Claude review accepted the change. It was committed and pushed, and Issue 5 was closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-issue-5-agent-tool-definition-cleanup).

## 2026-10-14 First-batch simplification

Issue 5 was pushed as `1fe7e7a`. Issues 8, 10, and 11 were implemented and reviewed as one batch:

- [Issue 8](https://github.com/ecwu/writellm/issues/8): the ten catalog write methods return `void`, and
  ProviderService builds one snapshot per settings response.
- [Issue 10](https://github.com/ecwu/writellm/issues/10) shares only behaviorally identical algorithms,
  with pre-extraction hash snapshots and probes proving equality:
  - Worker provider errors (`agent-provider-errors.ts`).
  - Trace JSON.
  - Four fingerprint serializers (`shared/canonical-json.ts`).
  - Manuscript search scope.
  - PDF and LaTeX table layout.
- [Issue 11](https://github.com/ecwu/writellm/issues/11):
  - Removed the unused finish and lease-expiry close policies, so every job aborts and requeues.
  - Added `ProjectRuntime.cancel()` as the IPC entrypoint.
  - JobStore is unchanged.

`check:package:smoke` and six packaged E2E scenarios passed. Claude review accepted the batch. Each
issue was committed separately, pushed, and closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-first-batch-simplification).

## 2026-10-14 Second-Batch Simplification

Issues [6](https://github.com/ecwu/writellm/issues/6) and [9](https://github.com/ecwu/writellm/issues/9)
were implemented and reviewed as one batch.

- **Issue 6, save normalization**:
  - Validated callers use the typed `ManuscriptService.appendValidatedRevision()`, while `appendRevision()` keeps validating direct callers.
  - One recursive traversal normalizes Math, Diagram, and figure metadata.
  - Fresh revisions reuse the prepared document.
  - A no-comment save drops from eleven whole-document parses to five.
  - Five pre-change snapshots of JSON, hash, and counts pass unchanged.
- **Issue 9, ordinary reads**:
  - `OpenedDatabase.read(callback)` runs synchronous related reads on the Main-owned connection with no write
    reservation. This relies on Main being the sole writer of `project.sqlite`.
  - The manuscript repository, assembly, workspace, and Agent session projections use it. Advisory guards stay advisory.

Claude review accepted the batch. Each issue was committed separately, pushed, and closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-second-batch-simplification).

## 2026-10-14 Third-Batch Simplification

- [Issue 7](https://github.com/ecwu/writellm/issues/7), production service ownership:
  - ProjectManager requires the complete Knowledge runtime factory and all feature services.
  - AgentSessionService requires all its dependencies.
  - IPC dropped repeated service-presence guards.
  - Every run, title, and compaction resolves the selected catalog model, and the singleton
    `withConfiguredProvider('agent')` branch and `legacyModelLimits()` were removed.
- [Issue 11](https://github.com/ecwu/writellm/issues/11)'s lifecycle boundary was already complete in
  `df3d1f89`, and its tests were repeated.
- Claude review found a regression, and the user approved the correction: sessions with a NULL selection adopt
  and persist the catalog default (`agent.session.model_selection_defaulted`). ADR 008 records the rule.
- The quick-action floating-menu E2E failure also reproduced on the baseline App and was left open.
  It was later resolved by the 2026-10-15 test-suite audit.
- Issue 7 was committed, pushed, and closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-third-batch-simplification).

## 2026-10-14 Fourth-Batch Simplification

Issues [12](https://github.com/ecwu/writellm/issues/12), [13](https://github.com/ecwu/writellm/issues/13), and
[14](https://github.com/ecwu/writellm/issues/14) were implemented and reviewed as one batch, starting from `46290a2`.

- **Issue 12**: `NotebookRegistry` owns the project collection, its limit of ten, and the close promise. `KnowledgeChatService` owns one
  transient conversation.
- **Issue 13**: the `useManuscriptFind`, `useManuscriptImport`, and `useManuscriptReferences` hooks own their state.
  Features receive business commands rather than QueryClient or editor references.
- **Issue 14**: `AgentSessionQueries`, `AgentSessionTitles`, `AgentSessionCompactor`, and
  `AgentRunCoordinator` were extracted. The full record contains the Map-entry and ActiveRun field writer tables.

Claude review accepted the batch. Each issue was committed separately, pushed, and closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-fourth-batch-simplification).

## 2026-10-14 Document Consolidation

- Issue 15 (documentation only, from `a04dc35`):
  - Architecture sections now state current rules by subject, with no dated amendment headings. It shrank from 2,084 to 1,884 lines.
  - Current-plan was reduced to active state, from 1,461 to 71 lines.
  - ADRs keep decision history.
- The full record holds:
  - A source map for every removed architecture block and all 131 removed current-plan blocks.
  - The retained unique result text.
  - Additional checks, such as the 22-tool list, the Notebook retrieval wording, and job-close alternatives.
  The existing history was left byte-for-byte intact.
- Claude review accepted the change. It was committed, pushed, and closed together with Issue 17.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-document-consolidation).

## 2026-10-14 Error Handling Ownership

- Issue 17 classified error handling from the `e565309` audit (A=3, B=7, C=6), starting from `a04dc35`:
  - The full record tables every Main and Worker site and its owner.
  - Shared contract catches keep expected Zod rejection, and diagnostic catches stay defensive.
  - `withIpcLogging` reports otherwise-unowned original errors before rethrowing.
  - 84 Renderer operational catches now use `reportRendererOperationError`.
  - `ProjectManager.isSessionActive` replaces exception-based capability lookups.
- Claude review accepted it. Two non-blocking follow-ups, IPC rejection log levels and private-text
  treatment of short strings, were later resolved on 2026-10-15.
- Issues 15 and 17 were committed, pushed, and closed. Issue 4 was closed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-14-error-handling-ownership).

## 2026-10-15 Test-Suite Audit

- Test-suite audit, with Claude diagnosing and reviewing and Codex implementing. The baseline was 64 of 67 source E2E scenarios.
- Fixed four product defects found by the suite:
  - The quick-action menu now renders into BlockNote's toolbar portal.
  - Outline drafts save against the version they were edited from, which fixes a lost update.
  - A streamed answer no longer duplicates the persisted copy.
  - Conversation status has accessible labels.
- Test changes:
  - Updated outdated tests.
  - Deleted no duplicates.
  - Added 96 missing cases, mostly IPC authorization, rejection, and cleanup.
  - Replaced zero-delay sleeps with observable conditions.
- The final `check:full` passed with all 67 source E2E scenarios.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-15-test-suite-audit).

## 2026-10-15 IPC Logging Follow-Ups

- Resolved both follow-ups from the Issue 17 error ownership review, in `ipc-context.ts`:
  - `withIpcLogging` accepts `isExpectedRejection`. A `ProjectSessionError`, direct or in the cause chain, now logs at warn.
  - `reportIpcFailure` no longer redacts UUID-shaped strings or strings shorter than four characters.
- The complete Vitest suite passed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-15-ipc-logging-follow-ups).

## 2026-10-15 Release 0.2026.10.2 Preparation

- Release `0.2026.10.2` was prepared from `8b4a653`. It changed only release metadata.
- `check:package` passed with 45 packaged scenarios.
- Release commit `d985a6a` and tag `v0.2026.10.2` were pushed, and tag build `38716401683` started.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-15-release-02026102-preparation).

## 2026-10-15 compatible dependency maintenance

- Under the ADR 056 amendment, from `6570126`:
  - Updated 24 direct dependencies, including Electron 44.7.2, Playwright 1.64.1, DOCX 9.11.0, and Dockview 8.5.1.
  - Overrides repaired three transitive advisories: http-cache-semantics, source-map-js, and fast-copy.
- Two advisories remain: a moderate sprintf-js advisory with no published repair, and a low KaTeX advisory because rehype-katex requires the 0.16 series.
- Mermaid was held at 12.1 to keep one KaTeX version.
- DOCX 9.11's generated bookmarks now receive stable names, keeping exports byte-identical.
- `check:package` passed, and all 67 scenarios passed.
- Release `0.2026.10.2` (`d985a6a`) was published separately.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-15-compatible-dependency-maintenance).

## 2026-10-21 Issue 18 engineering quality

Implemented [Issue 18](https://github.com/ecwu/writellm/issues/18), starting from `6570126`:

- Error handling and source guard (ADR 086):
  - Renderer recovery reports the original errors.
  - The source guard rejects unmarked empty and parameterless catches.
  - Session generations and action tokens reject stale project operations.
- Persistence and IPC:
  - Prepared SQL is the primary project database implementation, and a schema contract test covers the database through migration 0048 (ADR 087).
  - Typed IPC endpoint tables cover 169 operations (ADR 088).
  - Manuscript and Agent writes share one section repository (ADR 089).
- Shared code:
  - New shared helpers for canonical JSON, SHA-256, cancellation, durable writes, backups, and utility errors.
  - The index worker uses the persistent utility lifecycle.
  - Ownership-based module extraction.
- Tests:
  - E2E typechecking joined the static gate.
  - Shared E2E helpers.
- Repository and dependencies:
  - Repository cleanup.
  - Provider logo deduplication.
  - The provider and archive library boundaries are recorded (ADR 090).
- The final package gate passed, and all 67 scenarios passed. A provider-logo resolver regression found during acceptance was fixed.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-21-issue-18-engineering-quality).

## 2026-10-21 Issue 18 delivery

The user authorizes committing and pushing the verified combined changes, then updating and closing Issue 18.
[Implementation commit 7da0fc8](https://github.com/ecwu/writellm/commit/7da0fc8a4417932553c49233ea9f72a8caf01d19) is pushed to `origin/main`.
It includes the Issue 18 maintenance and the earlier verified dependency and DOCX changes.

[Issue 18](https://github.com/ecwu/writellm/issues/18) closes as completed at 17:22:16 UTC.
Its body preserves the original audit and adds the implementation commit, item dispositions, acceptance results, and platform limits.
The update names the retained architecture boundaries and the deferred, non-blocking decomposition and test fixture opportunities.
It does not claim that every large module or specialized adapter requires replacement.

Delivery reuses the recorded application acceptance because runtime source does not change.
Staging exposes extra trailing blank lines in four new documents, which are removed before the implementation commit.
The follow-up documentation records the actual push and closure and corrects stale tracker status.
Document links, guidance consistency, and staged whitespace checks pass.
No application build or tests repeat for these document changes.

The local App and installers retain version 0.2026.10.2 and the accepted runtime contents.
This delivery creates no tag or release and does not change the published release artifacts.
Earlier history entries retain their original local-only state as past evidence.

## 2026-10-21 Issue 19 follow-up repairs

- Repaired [Issue 19](https://github.com/ecwu/writellm/issues/19), the audit of the Issue 18 delivery in commit `7da0fc8`, under
  [ADR 091](../adrs/091-issue-19-endpoint-authority-and-compatibility.md):
  - `registerIpcEndpoint` is the only Main-side IPC authority, and handlers receive the checked `ProjectContext`.
  - `createEndpointRegistrar` accepts only endpoint definitions, which removes the unauthorized fallback.
  - Domain lifecycle logging runs through `around`.
  - An allowlist test covers the fifteen project-scoped `session: 'none'` endpoints.
- Canonical JSON gained legacy compatibility profiles.
- The error-handling guard also rejects unbound and unused catch bindings, using the shared tokenizer in
  `scripts/lib/ts-source.mjs`. TypeScript is pinned to 7.0.2.
- Added `cachedStatement`, frozen migration helpers, and `createAbortError`.
- The static gate, 1,911 tests, and 67/67 source E2E passed. The pnpm wrapper could not run, so commands ran directly.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-21-issue-19-follow-up-repairs).

## 2026-10-21 Pi 1.3 and compatible dependency maintenance

- Pi Agent Core and Pi AI were updated from 1.0.0 to 1.3.0 (ADR 056 amendment).
- Pi 1.0.3 renamed the built-in Azure provider. The catalog keeps the stable `builtin:azure-openai-responses`
  key, so selections and bound credentials survive. Azure models now stream through Pi's Azure provider.
  While confirming the old routing bug, one request with the fake key `azure-test-key` reached
  `api.openai.com` and received a 401.
- Applied compatible updates at least one day old, including Vite 7.3.7, which repairs five advisories. The audits are back at
  baseline.
- The package gate passed with 45/45 packaged scenarios and 67/67 source scenarios.
- A HEAD bisect showed that the `workbench.tabs-docking-restore` native-menu Knowledge toggle failure is
  pre-existing and intermittent: it fails 2 of 25 runs on unmodified `7b5e287`.

Full record: [original entry](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/history/implementation-log.md#2026-10-21-pi-13-and-compatible-dependency-maintenance).

## 2026-10-22 Release 0.2026.10.3 preparation

The user authorizes committing and pushing the verified changes to `main`, building the App locally, and tagging and releasing the next 0.2026.10.x version after a successful build.

The Issue 19 repairs and the dependency update are committed separately, so each can be reviewed and reverted on its own:

- [`ad0786e`](https://github.com/ecwu/writellm/commit/ad0786e) contains the Issue 19 repairs.
- [`0f8d964`](https://github.com/ecwu/writellm/commit/0f8d964) contains the Pi 1.3 and compatible dependency update.

Before the first commit, its staged tree passes alone: the static gate and 1,911 Electron tests pass with the dependency changes set aside.
Both commits are pushed to `origin/main` as `7b5e287..0f8d964`.

`package.json#release.version` advances to 0.2026.10.3. The SemVer base remains 0.2026.10.
The complete package gate passes all ten stages in 270.0 seconds with one App build.
It covers the packaged runtime smoke, all 45 packaged interaction scenarios with zero retries or skips, the installers, and artifact checksums.
The App reports `CFBundleVersion` 2026.10.3 and short version 0.2026.10.

| Artifact | SHA-256 |
| --- | --- |
| `WriteLLM-0.2026.10.3-arm64.dmg` | `ea1be599def4779e7197747d61ad8b45dc52b3a1504613257a3815aacc8e4104` |
| `WriteLLM-0.2026.10.3-arm64.zip` | `feb466de2a8a553caf1c28a356405f0777bbe6d8ae3dedaca94bf19be8921613` |

Application source is unchanged from the accepted dependency maintenance, whose 1,913 Electron tests and 67 source scenarios remain valid.
Local runtime acceptance covers macOS arm64 only. Distribution remains unsigned and unnotarized.

Evidence: [package gate](../../.cache/verification/1792658329924-20383-5ce61f67) and [package evidence](../../dist/macos-arm64/package-evidence.json).

## 2026-10-22 Release 0.2026.10.3 publication

Release commit `167026d` is pushed to `origin/main`. The annotated tag `v0.2026.10.3` points to it.
The [cross-platform tag build](https://github.com/ecwu/writellm/actions/runs/39757488096) passes the static and fixture gate and all four platform builds on its first attempt:

- Windows x64
- macOS arm64
- macOS x64
- Linux x64

The [automatic publication run](https://github.com/ecwu/writellm/actions/runs/39758438799) succeeds and publishes the non-prerelease [WriteLLM 0.2026.10.3](https://github.com/ecwu/writellm/releases/tag/v0.2026.10.3) at 09:51:11 UTC.
The release attaches exactly four assets:

- the Windows x64 setup EXE
- the macOS arm64 and macOS x64 DMGs
- the Linux x64 AppImage

Hosted rows build and inspect packages without runtime tests. Runtime acceptance remains macOS arm64 only.
This record changes no application source, and the tag does not move.

## 2026-10-22 Documentation evidence archive

The user asks to simplify the 1.9 MB `docs/` tree while keeping the decision history.
[ADR 092](../adrs/092-documentation-evidence-archive.md) records the decision. It also amends the
append-only rule for this one summary pass. Commit `493f02a` is the evidence archive.

- History log: entries longer than 30 lines become summaries with a `Full record` link, and
  shorter entries stay verbatim. Size: 533 KB → 132 KB.
- Phase files: evidence sections and paragraphs become `archived record` links, and plans,
  decisions, and acceptance criteria stay. The Checkpoint 26.9 CI attempt narrative becomes an
  outcome summary. Size: 509 KB → 380 KB.
- `architecture.md`: feature detail already stated in the cited ADRs is condensed. Size: 1,907 →
  1,720 lines, 112 KB → 99 KB.
- `current-plan.md` keeps only current state, gaps, authorized work, and deferred scope. It also
  fixes the stale "Issue 19 remains uncommitted" line. Size: 12 KB → 4 KB.
- ADRs are unchanged. AGENTS.md gains the concise-evidence rule, and the docs and ADR indexes link
  ADR 092.

Markdown in `docs/` falls from 1.67 MB to 1.12 MB. ADRs (442 KB) are now the largest part.

Verification is documentation-only, with no build or tests:

- A repository link check resolves every relative Markdown link and heading anchor.
- Every pinned `Full record` (79) and `archived record` (86) anchor resolves in the files at
  `493f02a`.
- `git diff --check` passes.

The ADR index also gains a one-line-per-ADR decision table, with 91 rows, a one-sentence decision for each, and a status of current, partly replaced, or replaced. No ADR body changes.
The user authorizes committing and pushing the change to `main`.
