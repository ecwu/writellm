# Implementation History

Completed checkpoint details remain in the Phase files under
`docs/implementation-todo/`. This chronology records cross-phase transitions and documentation
maintenance without turning the active tracker back into a historical log.

## 2026-08-13

- Completed the remaining Phase 11 sequence (CP41A PDF, CP41B presets, CP36 Markdown import,
  CP37A/37B LaTeX import, CP44 annotations, CP46 clone, and CP47A/47B templates) and the cumulative
  final gate: `check:fast`, 178 Electron-hosted files / 904 tests plus the production build, all 25
  recovery fixtures from 23 sources, clean scoped Impeccable and diff checks, and 38/38 fresh
  Real-Electron scenarios. The no-identity macOS arm64 package gate produced the 0.2026.8.16 App,
  DMG, and ZIP. A structured-lifecycle-logging pass over every Phase 11 module was then committed,
  and local packaging was verified on Windows, macOS x64, and Linux through the added per-target
  package commands.
- Completed Checkpoint 40 under ADR 030. The shared publication assembly now emits a deterministic,
  injection-bounded XeLaTeX/ctexart project with contained assets, readable non-fabricated
  references, source hash, and explicit losses. Independent unified-latex parsing, 166 files /
  860 tests, and the production build passed. Checkpoint 41A started next.
- Completed Checkpoints 38 and 39. A deterministic non-authoritative publication assembly now
  drives exact preflight navigation and fail-closed format conversion. The global export surface
  produces editable canonicalized DOCX packages through the existing snapshot/asset/atomic
  boundary, with independent OOXML and semantic reopen validation. `check:electron` passed 165
  files / 857 tests plus the production build. Checkpoint 40 started next.
- Completed Checkpoint 43B image iteration under ADR 029. Exact generated-figure targets now use
  the ordinary Agent image tool and existing provider gateway; immutable candidates retain explicit
  parent/model/Agent/tool lineage and become normal section proposals, preserving figure metadata
  and revision undo. Focused coverage plus `check:electron` passed 164 files / 853 tests and the
  production build. Checkpoint 38 started next in the authorized Phase 11 order.

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
- Completed the early "Stable Default Window State" maintenance: each new application window is
  maximized once before first display while later project-lifecycle operations preserve
  user-managed window state. Evidence passed Electron-hosted Vitest 28 files / 141 tests and the
  4-scenario Playwright Electron E2E suite. Archived here from the removed standalone
  `maintenance.md`.

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
- Locally completed the authorized Checkpoint 31 implementation under accepted ADR 023. Exact text
  selections now expose bounded rewrite, shorten, expand, tone, evidence, manuscript-alignment,
  and custom actions through the visible ordinary Agent conversation. Renderer freezes and
  displays the selection; Main revalidates the current revision, ordered blocks, and selected text
  before building the task; all model work and writes retain the normal Agent proposal/review path.
- CP31 evidence passed the focused 55-test suite, `check:fast`, 150 Electron-hosted test files and
  816 tests, the production build, focused and full Real-Electron suites with 28/28 full scenarios,
  25 recovery fixtures, clean scoped Impeccable detection, and `git diff --check`. Release metadata
  and packaged artifacts remain `0.2026.8.15`; package/release, hosted CI, commit, tag, push,
  publication, and promotion did not run.
- Advanced release metadata to `0.2026.8.16` at the user's request and started the no-identity
  macOS arm64 package gate for a local CP31 hands-on testing App. The package SemVer remains
  `0.2026.8` and the mapped macOS build version is `2026.8.16`. The gate passed 12 packaged runtime
  smoke scenarios, 17 packaged E2E scenarios, and all 25 recovery fixtures; verified arm64 native
  resources and a no-Team-ID ad-hoc/linker signature; and produced the App, DMG, and ZIP. Commit,
  tag, hosted CI, Apple signing/notarization, push, publication, and promotion remain outside scope.

## 2026-08-13

- Locally completed the authorized Checkpoints 32, 45, and 33 implementation under accepted ADR
  024. The ordinary Agent loop now owns deterministic and semantic review through pure snapshot
  checks and bounded Review Issue tools; versioned Brief-owned Writing Rules enter trusted Agent
  context; existing proposals can resolve claimed issues; and passive Issues/Writing Rules
  Workbench surfaces provide no second model execution path.
- Final evidence passed `check:fast`; 154 Electron-hosted test files and 829 tests; the production
  build; focused Agent-native and passive-Workbench Real-Electron scenarios; 30/30 fresh full
  Real-Electron scenarios; all 25 recovery fixtures from 23 sources; clean scoped Impeccable
  detection; and `git diff --check`. The full scenario proves the ordinary
  `check_draft → list_review_issues → record_review_issues` flow and durable correction history.
- Started Checkpoint 34A under the user's explicit authorization to complete the remaining Phase
  11 sequence and build a local App for hands-on testing. Implementation will keep plans as
  bounded collaboration state around the existing Agent loop, not a scheduler or new mutation
  authority.
- Completed Checkpoint 34A under accepted ADR 025. The project now persists one bounded task per
  Agent conversation with stable UUID task/step identities, monotonic optimistic plan versions,
  ordinary Agent task tools, exact proposal correlation, and a passive plan projection. Final
  evidence passed 157 Electron-hosted test files and 835 tests, a production build, 31/31 full
  Real-Electron scenarios, all 25 recovery fixtures, scoped Impeccable detection, and diff checks.
- Started Checkpoint 34B to derive truthful plan progress from exact Agent-run and proposal
  outcomes and add idle revise/resume controls inside the existing conversation canvas.
- Completed Checkpoint 34B. Ordinary Agent runs now snapshot exact task/step identity; bounded
  progress is derived from run and proposal truth; disagreement is explicit; and idle plan revision
  plus Resume stay inside the same conversation. Final evidence passed 158 Electron-hosted test
  files and 839 tests, a production build, 31/31 full Real-Electron scenarios, all 25 recovery
  fixtures, scoped Impeccable detection, and diff checks.
- Started Checkpoint 35A to group task-correlated proposals into a read-only cross-section change
  set while retaining the existing exact proposal review surface as the only decision surface.
- Completed Checkpoint 35A. The conversation now derives a task-wide proposal summary and grouped
  exact diffs from immutable task/step correlation, surfaces refresh-required state, and navigates
  back to the existing proposal review surface. Focused projection and Real-Electron restart
  coverage, `check:fast`, and `check:electron` passed with 158 files and 840 tests.
- Started Checkpoint 35B to add a Main-owned, idempotent, crash-recoverable sequence over existing
  individual proposal decisions, with explicit dependency order and partial results.
- Completed Checkpoint 35B under accepted ADR 026. Selected task proposals now flow through the
  existing individual authorization and mutation services in deterministic dependency order, with
  a bounded durable command receipt/cursor, explicit stop-on-adverse partial results, optional
  ready-only history checkpoints, and deterministic replay/undo reconciliation. Final evidence
  passed 160 Electron-hosted test files and 844 tests, a production build, 31/31 full
  Real-Electron scenarios, all 25 recovery fixtures, scoped Impeccable detection, and diff checks.
- Started Checkpoint 43A to establish stable figure identity, caption, alt text, derived numbering,
  deterministic review targets, and the publication-node figure contract without adding provider
  work or a second content authority.
- Completed Checkpoint 43A under accepted ADR 027. Section content schema v3 adds stable figure
  IDs and explicit caption/alt metadata while preserving all historical revision bodies; figure
  numbering is derived and the ordinary review tool reports exact missing-metadata targets. Final
  evidence passed 162 Electron-hosted test files and 848 tests, a production build, 31/31 full
  Real-Electron scenarios, all 25 recovery fixtures, scoped Impeccable detection, and diff checks.
- Started Checkpoint 42 to expose the existing immutable manuscript-asset catalog through bounded
  metadata, current/history/proposal usage, protected deletion, and session-bound navigation.
- Completed Checkpoint 42 under accepted ADR 028. The Images workspace now projects validated
  dimensions, integrity, source lineage, current/history/proposal usage, bounded filters and exact
  navigation from the existing immutable asset catalog. Two-phase protected deletion is recovered
  on open and through the existing cleanup lifecycle. Final evidence passed 163 Electron-hosted
  test files and 851 tests, a production build, 31/31 full Real-Electron scenarios, all 25
  recovery fixtures, scoped Impeccable detection, and diff checks.
- Started Checkpoint 43B to iterate existing figures through the ordinary Agent image tool,
  immutable candidate lineage, and the existing exact proposal review/application authority.
- Completed Checkpoint 41A PDF publication under accepted ADR 031. One Main-owned hidden,
  sandboxed Chromium renderer now produces tagged PDFs with mixed CJK/Latin text, figures,
  formulas, References, bookmarks, links, headers/footers, and bounded stabilized TOC page numbers
  from the shared CP38 assembly. Print-layout preflight and cancellable progress remain passive
  fixtures around the existing export boundary.
- CP41A verification passed 167 Electron-hosted files and 868 tests, the production build, a real
  Electron/pdfjs target-runtime spike, all 12 packaged smoke scenarios, and 19/19 packaged E2E
  scenarios. The no-identity arm64 package gate verified ASAR/native inventory and produced the
  App, DMG, and ZIP; it also caught and permanently covered a sandboxed-preload Node dependency
  leak and the schema-v3 packaged-reopen assertion.
- Started Checkpoint 41B to add one bounded app.sqlite publication-preset catalog whose stable
  cross-format options feed the existing CP38 assembly without mutating manuscript revisions.
- Completed Checkpoint 41B. App migration v7 seeds three immutable presets; one bounded repository
  adds user CRUD, strict fail-closed versioned options, and a unique default. The global Settings
  Command edits user presets, while preflight, DOCX, LaTeX, and PDF all resolve the same options
  before building the shared publication assembly. Final evidence passed 168 Electron-hosted files
  and 871 tests plus a production build.
- Started Checkpoint 36 to replace the Renderer-driven Markdown section import with a Main-owned,
  immutable staged import plan, preview, explicit apply mode, and exact revision revalidation.
- Completed Checkpoint 36 under ADR 032. Main now owns bounded source capture, hashing, contained
  resource registration, exact-pinned remark mapping, session cleanup, typed side-by-side review,
  atomic imported-section creation, and active-section optimistic replacement. The legacy
  Renderer file/parser path is removed. Verification passed 170 Electron-hosted files / 878 tests,
  the production build, and all 32 silent Real-Electron scenarios. Checkpoint 37A started next.
- Completed Checkpoint 37A under ADR 033. One staged `.tex` file now parses in a disposable,
  timeout-bounded utility process through exact-pinned unified-latex and an application-owned
  neutral projection. Structure and display formulas map to editable BlockNote content; inline
  math, footnotes, citations, comments, malformed syntax, custom macros, and unknown constructs
  remain visible and inert with exact findings. Verification passed 26 focused tests,
  `check:fast`, 172 Electron-hosted files / 884 tests, the production build, 33/33 silent
  Real-Electron scenarios, and all 25 recovery fixtures. Checkpoint 37B started next.
- Completed Checkpoint 37B under ADR 034. Bounded directories, ZIP archives, and direct-entry
  dependency closures now resolve contained includes, bibliography data, tables, figures, labels,
  and registered images through the same staged review plan and disposable no-network parser.
  Verification passed 172 Electron-hosted files / 888 tests, 34/34 full Real-Electron scenarios,
  all 25 recovery fixtures, UI/diff gates, and the macOS arm64 package gate with 12 smoke
  scenarios and 22/22 packaged E2E scenarios. Verified App, DMG, and ZIP artifacts were produced.
- Started Checkpoint 44 to add one small project-local annotation/TODO authority outside
  manuscript content, with explicit orphaning, Agent-request opt-in, and history rollback.
- Completed Checkpoint 44 under ADR 035. Project-local notes and TODOs now use stable exact
  section/block anchors, explicit orphaning, history rollback, export/context exclusion, a passive
  Review Center, and opt-in routing into the ordinary Agent conversation.
- Completed Checkpoint 46 under ADR 036. Clone / Save As now captures open WAL state through the
  existing snapshot barrier, rewrites enumerated project identity, omits derived/private/transient
  state, validates the staged inventory, and opens the independent result normally.
- Completed Checkpoints 47A and 47B under ADR 037. Two reviewed built-ins and a bounded,
  hash-verified user catalog reuse normal project authorities and carry only previewed Brief,
  outline, Writing Rules, and optional publication-preset references with fresh identities.
- Started final Phase 11 cumulative Real-Electron, recovery, UI/diff, and macOS arm64 package
  verification.
- Completed final Phase 11 verification. `check:fast`, the complete Electron-hosted gate and
  production build, 25 recovery fixtures, UI/diff checks, and 38/38 fresh Real-Electron scenarios
  passed. The macOS arm64 package gate passed 12 smoke and 26/26 packaged E2E scenarios, verified
  the ASAR/native inventory, and produced structurally verified 0.2026.8.16 App, DMG, and ZIP
  artifacts.
- Replaced the dark textured application icon with a light mist-blue tile, warm-white folded-paper
  `W`, and cobalt pen-nib accent. Regenerated the 1024px packaging PNG, 512px Linux runtime PNG,
  seven-frame Windows ICO, and multi-size macOS ICNS from the same master. `pnpm check` passed;
  the macOS arm64 `check:package` gate passed all 12 packaged smoke scenarios and 26/26 packaged
  E2E scenarios, and the packaged `icon.icns` SHA-256 exactly matched `build/icon.icns`
  (`7e605de1942ef9f3e7a4cc39a48d1ead2448c215948ccc6377775fa3d0f954b2`). The no-identity gate
  produced `WriteLLM-0.2026.8.16-arm64.dmg` (258,126,721 bytes; SHA-256
  `d08d75cf1e3914b56f34ae3f585bf8bc7862bf1d653e0e56f80af6232e4c192b`) and the companion ZIP
  (256,044,716 bytes; SHA-256
  `ebcda1b9986b2562e65cac8f1442038c4fc4370c597e065545ff07acf8c15fbd`). Signing, notarization,
  hosted CI, push, release, and promotion were not performed.
- Refined the generated icon after Dock-size inspection showed insufficient separation between the
  pale tile and warm-white W. Kept the folded-paper and cobalt pen-nib geometry while deepening the
  tile to a calm medium slate/cornflower blue, then regenerated the packaging PNG, Linux runtime
  PNG, Windows ICO, and macOS ICNS from the revised master. The macOS arm64 unpacked package gate
  passed all 12 packaged smoke scenarios and 26/26 packaged E2E scenarios; the App's packaged ICNS
  exactly matched `build/icon.icns` at SHA-256
  `b026eb458df23f7f6bb2cf5333583e5f387cca2c50523deeb806d339c86d0012`. The App remains ad-hoc,
  no-Team-ID, and unnotarized; no DMG or ZIP was produced in this refinement.
- Started Phase 12 as an evidence-driven Use And Fix phase and accepted ADR 038 for Checkpoint 48.
  The decision replaces ADR 016's five separately visible composer controls with Add, truthful
  approval policy, combined model plus effort, and Send; context and Writing Skill remain available
  through one shared Add/leading-slash catalog. No Agent authority, persistence, provider, prompt,
  worker, migration, package/release, hosted CI, commit, push, or publication boundary changed.
- Implemented the Checkpoint 48 Agent composer refinement. Add and a leading slash now share one
  context/Writing Skill catalog; approval choices explain the bounded proposal policy; and one
  progressive model/effort popover displays concise labels such as `GPT 5.6 Sol xhigh` without
  redundant provider branding. Focused Renderer tests, 179 Electron files / 915 tests plus the
  production build, three focused Real-Electron scenarios, bounded screenshot review, scoped and
  full-code Biome checks, Impeccable, and diff checks passed. Formal closure remains pending only
  because the ordinary all-file formatter reports the preserved user-owned concurrent
  `.vscode/settings.json` edit; no unrelated file was rewritten to manufacture a green gate.
- Built the explicitly authorized Phase 12 hands-on macOS arm64 App with the no-identity unpacked
  package gate. Electron 43.1.0 / ABI 148, the arm64 native inventory, 45,783 ASAR entries, all 12
  packaged smoke scenarios, and all 26 packaged E2E scenarios passed with no flaky, skipped, or
  failed result. The gate produced only `dist/macos-arm64/mac-arm64/WriteLLM.app` at version
  `0.2026.8` / build `2026.8.16` and verified that it has no Apple Team ID. No DMG, ZIP, signing
  identity discovery, notarization, hosted CI, commit, push, release, or promotion was performed.
- Accepted ADR 039 after hands-on use exposed a composer collision, then restored the icon-free
  `Manual`, `Section`, and `YOLO` approval shorthand and made the model trigger yield width before
  Send. Scoped static checks, 11 focused Renderer tests, the 179-file / 915-test Electron gate and
  production build, one focused Real-Electron workflow with explicit control-bound assertions,
  screenshot review, Impeccable, and diff checks passed. No second App package or release action
  was performed.
- Accepted ADR 040 and replaced the idle paper-plane-plus-text Send control with an accessible
  primary circular Lucide upward-arrow button while preserving Queue, Steer, retry, and Stop.
  Scoped checks, 11 focused Renderer tests, the final clean 179-file / 915-test Electron gate and
  production build, two focused Real-Electron passes, enabled/disabled screenshot review,
  Impeccable, and diff checks passed. One unrelated export-test timeout passed alone in 428 ms
  before the clean full rerun. No second App package or release action was performed.
- Rebuilt the final Checkpoint 48 macOS arm64 App after the ADR 039/040 hands-on refinements. The
  no-identity unpacked package gate verified Electron 43.1.0 / ABI 148, the arm64 native and
  45,783-entry ASAR inventory, all 12 packaged smoke scenarios, and all 26 packaged E2E scenarios
  with no flaky, skipped, or failed result. It produced only the no-Team-ID
  `dist/macos-arm64/mac-arm64/WriteLLM.app`; no DMG, ZIP, signing, notarization, hosted CI, push,
  release, or promotion was performed.
- Created the explicitly authorized local Phase 12 commit containing the Agent composer,
  ADR/Phase documentation, affected tests, and the already recorded application-icon assets. The
  unrelated concurrent `.vscode/settings.json` and `section-editor.tsx` edits were left
  uncommitted. No push, tag, hosted CI, signing, notarization, release, or promotion was performed.
- Accepted ADR 041 and started Checkpoint 49. The authorized change makes pending Follow-ups a
  bounded, Main-authoritative active-run queue with per-item Steer/Delete, one Pi queue head, and a
  persist-before-provider consumption barrier; the running composer becomes a Stop-or-Send action
  plus a contextual waiting list. No migration, dependency, worker role, durable job, package,
  release, hosted CI, commit, push, or publication action was authorized.
- Completed Checkpoint 49 under ADR 041. Main now owns a bounded addressable pending Follow-up
  queue, the agent worker loads only its head into Pi and waits for durable consumption approval,
  and the live Composer exposes an internally scrolling Steer/Delete list with one circular
  Stop-or-Queue action. Static checks, 179 Electron test files / 922 tests, production build, the
  focused provider-order Real-Electron scenario, screenshot inspection, Impeccable, and diff checks
  passed. The full E2E suite retained one separately reproduced pre-existing Writing Skill popover
  failure; the Checkpoint 49 scenario passed on every run. No package, commit, push, release, or
  hosted action ran.
- Independently committed the completed Checkpoint 49 work as `45cb477`, excluding the unrelated
  local `.vscode/settings.json`, `section-editor.tsx`, and Checkpoint 50 design changes. Then
  accepted ADR 042 and started authorized Checkpoint 50 to harden all 20 Agent tools using compact
  Pi-style preflight schemas, Main-authoritative invariants, contract v8, tool-aware recovery, and
  safe failure presentation.
- Completed Checkpoint 50 under accepted ADR 042. All 20 model-visible tools now use compact
  Pi-style descriptions and one-way-compatible model schemas with Main-authoritative business
  invariants; contract v8 preserves v1-v7 replay, canonical section payloads are opaque to the
  model, outline provisional ordering and image modes are repaired, errors carry safe actionable
  recovery, and approval continuation remains within the original request scope. Focused suites,
  `check:fast`, 179 Electron-hosted files / 931 tests with three skips and production build, all 39
  unpacked E2E scenarios, the zero-preflight Brief/outline regression, the native/package smoke,
  and all 27 packaged E2E scenarios passed. At the user's direction, CP50 did not send a live
  Gemini request; deterministic provider-neutral evidence is the closure gate. No hosted CI,
  signing, notarization, push, publication, or release was performed, and CP50 remains uncommitted
  pending separate authorization.
