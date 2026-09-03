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
- Completed Checkpoint 43B image iteration under ADR 029. Exact generated-figure targets use the
  ordinary Agent image tool and existing provider gateway; immutable candidates retain explicit
  parent/model/Agent/tool lineage and become normal section proposals, preserving figure metadata
  and revision undo. Focused coverage plus `check:electron` passed 164 files / 853 tests and the
  production build.
- Completed Checkpoints 38 and 39. A deterministic non-authoritative publication assembly drives
  exact preflight navigation and fail-closed format conversion. The global export surface produces
  editable canonicalized DOCX packages through the existing snapshot/asset/atomic boundary, with
  independent OOXML and semantic reopen validation. `check:electron` passed 165 files / 857 tests
  plus the production build.
- Completed Checkpoint 40 under ADR 030. The shared publication assembly emits a deterministic,
  injection-bounded XeLaTeX/ctexart project with contained assets, readable non-fabricated
  references, source hash, and explicit losses. Independent unified-latex parsing, 166 files /
  860 tests, and the production build passed.
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

- Completed the authorized local `0.2026.8.17` candidate maintenance: advanced release metadata,
  refreshed three stale recovery source hashes plus one renamed fail-closed Agent case, and passed
  `check:fast`, all 25 recovery fixtures from 23 sources, the no-identity macOS arm64 production
  package, native/ASAR/resource and signature-policy checks, 12/12 packaged smoke scenarios, and
  28/28 packaged Real-Electron scenarios. The clean release commit receives the annotated
  `v0.2026.8.17` tag and the final App is rebuilt from that tag. No push, hosted CI, Apple Developer
  ID signing, notarization, GitHub Release creation, or promotion ran.

- Accepted ADR 047 and completed Checkpoint 52. The application now has a read-only Checks
  workspace whose Main-owned, snapshot-bound service derives article-level Knowledge citation
  coverage from current manuscript revisions and only the active current text-index generation.
  Duplicate titles remain ambiguous, unmatched citations remain explicit, and no private path or
  persisted coverage authority crosses IPC. Focused tests, `check:fast`, 181 Electron-hosted test
  files / 965 tests plus production build, all 41 fresh Real-Electron scenarios, screenshot
  inspection, Impeccable, and diff checks passed. No migration, package, commit, push, hosted CI,
  signing, release, or publication action ran.
- Accepted ADR 048 and completed Checkpoint 53. Main can now copy one exact current-run,
  active-asset-backed root image into another section through the existing section proposal path,
  preserving figure metadata while minting a destination block ID. Agent policy requires an
  applied destination insertion before exact source removal; pending or failed insertion cannot
  delete the source, and a changed source hash leaves a safe duplicate without a deletion retry.
  Cross-section `moveBlocks` now returns actionable argument repair. Focused tests, `check:fast`,
  182 Electron-hosted test files / 980 tests plus production build, and all 41 fresh Real-Electron
  scenarios passed. No migration, provider call, package, commit, push, hosted CI, signing,
  release, or publication action ran.
- Accepted ADR 049 and completed Checkpoint 54. Conversation compaction now combines freshly
  rebuilt authoritative writing context, a bounded writing-specific v3 handoff, and an adaptive
  recent suffix of verbatim complete turns. Long user and terminal assistant messages are no
  longer reduced to 1,024-character head/tail projections; legacy/v2 checkpoints remain
  authority-free, while v3 can continue user goals and constraints without granting manuscript,
  evidence, proposal, or mutation authority. Unsafe recovery now stops before omitting an
  uncheckpointed requirement. Focused tests, `check:fast`, 182 Electron-hosted test files / 984
  tests plus production build, and all 41 fresh Real-Electron scenarios passed. No migration,
  provider call, package, commit, push, hosted CI, signing, release, or publication action ran.
- Accepted ADR 050 and completed Checkpoint 55. The Renderer now shows latest trustworthy
  run-matched context usage as a neutral accessible circular indicator beside the Agent
  model/Thinking trigger, with keyboard/hover detail and no stale-model or unknown zero state.
  Focused tests, `check:fast`, 183 Electron-hosted files / 990 tests plus production build, one
  focused Real-Electron scenario, screenshot inspection, scoped Impeccable, independent finish
  review, and diff checks passed. No new action, IPC, persistence, provider, worker, migration,
  dependency, package/release, hosted CI, commit, push, signing, notarization, or publication work
  ran.
- Completed Checkpoint 56. The Agent writing-task plan now occupies one centered Step capsule above
  the composer and opens a bounded, accessible shadcn Popover containing the semantic step list,
  plan controls, and unchanged change-set workflow; terminal plans remain available as
  `Plan complete`. Focused tests, `check:fast`, 183 Electron-hosted files / 991 tests plus
  production build, one fresh focused Real-Electron scenario, scoped Impeccable, independent finish
  review, and diff checks passed. No IPC,
  persistence, provider, worker, migration, dependency, package/release, hosted CI, commit, push,
  signing, notarization, or publication work ran.
- Accepted ADR 051 and completed Checkpoint 57. Image generation now uses one fixed Google Gemini,
  OpenAI `gpt-image-2`, and xAI `grok-imagine-image-2.0` catalog with independently encrypted
  credentials, one explicit active source, fixed official endpoints, no automatic fallback, and
  exact-pinned `openai@7.5.0` confined to the background worker. The app.sqlite v9 migration
  preserves legacy Gemini configuration/ciphertext; strict IPC, safe SDK error/base64 projection,
  nullable OpenAI auto sizing, request-scoped provider/model lineage, and the existing asset and
  proposal authority remain enforced. Focused tests, `check:fast`, 184 Electron-hosted files / 1009
  tests plus production build, 41/41 full Real-Electron scenarios, 25 recovery fixtures, the
  no-identity macOS arm64 package gate, 12/12 packaged smoke scenarios, 28/28 packaged E2E
  scenarios, and diff checks passed. No billable live image request, commit, push, hosted CI,
  signing identity, notarization, release, promotion, or publication ran.

## 2026-08-19

- Completed the separately authorized local `0.2026.8.20` App candidate for Checkpoint 61.
  Release metadata advanced after `check:fast`, 187 Electron-hosted files / 1043 tests plus
  production build, 41/41 fresh Real-Electron scenarios, 25 recovery fixtures from 23 sources,
  and diff checks passed. The clean local release commit received the annotated
  `v0.2026.8.20` tag, and the no-identity macOS arm64 unpacked package gate verified Electron
  43.1.0 / ABI 148, arm64 native modules, ASAR/resources, 12/12 packaged smoke scenarios, and
  28/28 packaged E2E scenarios. No DMG, ZIP, push, hosted CI, Apple Developer ID signing,
  notarization, GitHub Release, promotion, or publication ran.
- Accepted ADR 055 and completed Checkpoint 61. Idle new-run prompts now autocomplete up to four
  leading `$skill-name` references as ordinary editable text. Main reparses and pins exact current
  versions, requires ordered visible `read_writing_skill` calls, admits explicit-only Skills only
  through user mentions, fails closed before downstream work or final output, and records v3
  Requested/Discovered provenance without session state or a database migration. Focused coverage,
  `check:fast`, 187 Electron-hosted files / 1043 tests with three benchmark skips plus production
  build, 25 recovery fixtures from 23 sources, and the fresh 41/41 Real-Electron suite passed.
  Desktop, Details, Impeccable, and diff checks passed. No tag, package/release, hosted CI,
  commit, push, signing, notarization, promotion, or publication ran.
- Completed the separately authorized local `0.2026.8.19` App candidate for Checkpoint 60.
  Release metadata advanced after `check:fast`, the 186-file / 1031-test Electron gate and build,
  41/41 fresh Real-Electron scenarios, and diff checks passed. The clean local release commit
  received the annotated `v0.2026.8.19` tag, and the no-identity macOS arm64 unpacked package gate
  rebuilt and verified the App from that tag through recovery, inventory, smoke, and packaged E2E
  checks. No DMG, ZIP, push, hosted CI, Apple Developer ID signing, notarization, GitHub Release,
  promotion, or publication ran.
- Accepted ADR 054 and completed Checkpoint 60. Writing Skills are now per-run, visible Agent tool
  actions rather than composer or session state: every run receives metadata only, and both a
  user-named Skill and an Agent-discovered Skill enter context solely through
  `read_writing_skill`. The bounded preparation phase supports four ordered top-level Skills,
  eight dependencies, twelve whole reference files / 32 KiB, exact allowlists, immutable replay
  provenance, safe activity projection, and read-only Agent Details history without scripts or
  broader authority. Focused coverage passed; `check:fast`, 186 Electron-hosted files / 1031 tests
  with three benchmark skips plus production build, and the fresh 41/41 Real-Electron suite passed.
  Desktop and Details screenshots plus diff checks passed. No migration, package/release
  gate, hosted CI, commit, push, signing, notarization, promotion, or publication ran.
- Completed Checkpoint 58. Whole-manuscript Markdown preview moved from the Outline Dialog into an
  independent Preview rail workspace, using the existing export projection and a project-owned
  shadcn Typeset preset. Session-bound assets, sanitized Mermaid, bounded KaTeX, safe HTTPS links,
  loss reporting, desktop layout, and return-to-section context remain enforced. Focused tests,
  `check:fast`, 185 Electron-hosted files / 1012 tests plus production build, the fresh 41/41
  Real-Electron suite, light/dark desktop visual inspection, scoped Impeccable, and diff
  checks passed. No IPC, shared contract, migration, dependency, package/release action, hosted CI,
  commit, push, signing, notarization, or publication ran.
- Built the separately authorized Checkpoint 58 hands-on App with the no-identity macOS arm64
  unpacked package gate. Electron 43.1.0 / ABI 148 native and ASAR/resource inventory, all 12
  packaged smoke scenarios, and 28/28 packaged E2E scenarios passed with no flaky, skipped, or
  failed result. The gate produced `dist/macos-arm64/mac-arm64/WriteLLM.app`; no DMG, ZIP, signing
  identity discovery, notarization, hosted CI, commit, push, release, promotion, or publication
  was performed.
- Accepted ADR 052 and completed Checkpoint 59. Google Vertex AI is now a fourth independent image
  source beside Google Gemini, OpenAI, and xAI, with a validated Project ID, fixed `global`
  location, the three Nano Banana model IDs, and local Application Default Credentials discovered
  only inside the background worker. WriteLLM accepts and stores no Vertex key or ADC token; one
  source remains explicitly active with no fallback. Focused suites passed 9 files / 83 tests,
  `check:fast` passed, the complete Electron-hosted gate passed 185 files / 1026 tests plus three
  intentional benchmark skips and production build, the fresh Real-Electron suite passed 41/41,
  all 25 recovery fixtures passed, and the no-Team-ID macOS arm64 package gate passed 12/12 smoke
  and 28/28 packaged E2E scenarios. No live ADC probe, billable image request, hosted CI, commit,
  push, signing identity, notarization, release, promotion, or publication ran.
- Completed the Checkpoint 59 hands-on large-image repair. The first live Vertex request proved
  local ADC and remote generation were working, but the returned inline image overflowed the
  worker's recursive Base64 regular expression before Main could publish it. A bounded linear
  validator and 8,000,000-character regression replaced that failure path. Focused tests,
  `check:fast`, 185 Electron-hosted files / 1027 tests plus three benchmark skips and production
  build, 41/41 fresh Real-Electron scenarios, 25 recovery fixtures, 12/12 packaged smoke, and
  28/28 packaged E2E scenarios passed. A replacement no-Team-ID macOS arm64 App, DMG, and ZIP were
  built from the current dirty worktree. No second billable image request, commit, push, hosted CI,
  Apple identity signing, notarization, release, promotion, or publication ran.
- Completed the separately authorized local `0.2026.8.18` candidate for Checkpoint 58/59 and the
  large-inline-image repair. Release metadata advanced, `check:fast`, `git diff --check`, all 25
  recovery cases from 23 sources, the no-identity macOS arm64 package gate, 12/12 packaged smoke
  scenarios, and 28/28 packaged Real-Electron scenarios passed before the clean local release
  commit received the annotated `v0.2026.8.18` tag. The App, DMG, and ZIP were rebuilt from that
  tagged revision. No push, hosted CI, Apple Developer ID signing, notarization, GitHub Release,
  promotion, or publication ran.
- Reconciled the documentation after Checkpoints 48–61. The active plan and tracker now contain
  only current state and compact routing; the former CP27–28 tracker evidence moved intact to
  `implementation-todo/phase-agent-writing.md`; Phase 11 and Phase 12 completion markers, the
  architecture amendment status through ADR 055, and the CP48 intermediate closure note now match
  the implemented baseline. The chronology was restored to date order and Phase 12 gained a
  complete checkpoint index. No architecture decision, product code, package, release, hosted CI,
  commit, push, signing, notarization, promotion, or publication boundary changed.

## 2026-08-20

- Built the separately authorized Checkpoint 62 hands-on macOS arm64 App from the current dirty
  worktree. The no-identity package gate verified Electron 43.1.0 / ABI 148, arm64 native modules,
  ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then produced
  the unpacked App, DMG, and ZIP under `dist/macos-arm64`. No candidate, commit, tag, push, hosted
  CI, Apple Developer ID signature, notarization, release, promotion, or publication ran.
- Completed Checkpoint 62. The global Settings Command remains one flat ordered peer list; General
  now reads as Appearance, Writing, and Agent defaults, while Keyboard Shortcuts and About &
  Diagnostics expose the actual fixed commands, application version, explicit credential-backend
  security state and warning, logs directory action, and sanitized diagnostic export. Existing
  Renderer-safe APIs and persistence paths were reused unchanged. Five focused Renderer tests,
  `check:fast`, 188 Electron-hosted files / 1048 tests with three benchmark skips plus production
  build, and the fresh 41/41 Real-Electron suite passed. Desktop screenshots,
  preference persistence, focus return, axe, scoped Impeccable,
  and diff checks passed. No ADR, shared contract, IPC, persistence, migration, dependency,
  package/release action, hosted CI, commit, push, signing, notarization, promotion, or publication
  ran.
- Completed Checkpoint 63. The Agent sidebar now uses exact-pinned, reduced-motion-aware thinking
  orbs for typed work states and a short one-shot border beam when review becomes actionable.
  Brief fields, ordered Outline operations, Writing Rule actions, section text, and generated
  images now render through one reusable semantic Proposal dispatcher in both the timeline and
  Writing Task change set; legacy proposals retain their diff fallback, and presentation data
  remains optional derived review data with no apply authority. Focused coverage passed 61 tests;
  `check:fast`, 189 Electron-hosted files / 1054 tests with three benchmark skips plus production
  build, and the fresh 41/41 Real-Electron suite passed. Full-width screenshots,
  dependency/reduced-motion review, frozen install, scoped Impeccable, and diff checks passed. No
  package/release, hosted CI, commit,
  push, signing, notarization, promotion, or publication action ran.
- Built the separately authorized Checkpoint 63 hands-on macOS arm64 artifacts from the current
  dirty worktree. The no-identity package gate verified Electron 43.1.0 / ABI 148, arm64 native
  modules, ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then
  produced the no-Team-ID App, DMG, and ZIP under `dist/macos-arm64`. No candidate, commit, tag,
  push, hosted CI, Apple Developer ID signing, notarization, release, promotion, or publication
  ran.

## 2026-08-23

- Accepted ADR 056 and completed Checkpoint 64. The bounded dependency refresh upgraded Electron
  43, BlockNote, PDF.js, Mermaid, Kysely, provider, Renderer, data, formatting, and test packages
  without crossing the deferred toolchain, native-database, or Agent-runtime major boundaries.
  Frozen installation passed; both production and complete audits report zero advisories; focused
  coverage passed 5 files / 58 tests; `check:fast`, 192 Electron-hosted files / 1062 tests with
  three benchmark skips plus production build, 25 recovery fixtures, and the fresh 42/42
  Real-Electron suite passed. The no-identity macOS arm64 package gate verified Electron 43.4.1 /
  ABI 148, arm64 native modules, 53,145 ASAR entries, 12/12 runtime smoke and 29/29 packaged E2E
  scenarios, and DMG/ZIP structure. No candidate, release gate, hosted CI, commit, tag, push, Apple
  Developer ID signing, notarization, promotion, or publication ran.
- Built the separately authorized Checkpoint 64 hands-on macOS arm64 App for local trial from the
  current dirty worktree. The unpacked-only no-identity package gate verified Electron 43.4.1 /
  ABI 148, arm64 native modules, 53,145 ASAR entries, 12/12 packaged smoke scenarios, and 29/29
  packaged E2E scenarios, then produced `dist/macos-arm64/mac-arm64/WriteLLM.app`. No DMG, ZIP,
  candidate, release gate, hosted CI, commit, tag, push, Apple Developer ID signing, notarization,
  promotion, or publication ran.
- Accepted ADR 058 and completed Checkpoint 66. Knowledge remains the independent source-management
  and exact-search workspace; the adjacent Notebook workspace now provides transient,
  project-session-scoped, selected-source multi-turn chat with bounded hybrid retrieval, streamed
  source-only answers, per-message validated citations, in-place citation preview, and metadata-only
  model-request accounting. Focused coverage, `check:fast`, 198 Electron-hosted files / 1097 tests
  with three benchmark skips plus production build, and the fresh 44/44 Real-Electron suite passed
  with no flaky or skipped scenario. Database and diagnostic assertions found no question, answer,
  evidence body, external response ID, or content-derived fingerprint. Checkpoint 65 returns as the
  current incomplete checkpoint; no migration, dependency, package/release action, hosted CI,
  commit, push, signing, notarization, promotion, or publication ran.
- Completed the separately authorized `0.2026.8.21` candidate snapshot. Release metadata advanced;
  the recovery fixture manifest was refreshed for the intentionally extended Knowledge/Notebook
  scenario; and the packaged reopen smoke was aligned with the accepted schema-v4 migration. The
  no-identity macOS arm64 unpacked package gate verified Electron 43.4.1 / ABI 148, arm64 native
  modules, 53,287 ASAR entries, all 26 recovery fixtures from 24 sources, 12/12 packaged smoke
  scenarios, and 31/31 packaged E2E scenarios before producing
  `dist/macos-arm64/mac-arm64/WriteLLM.app`. The clean candidate commit receives the annotated
  `v0.2026.8.21` tag, and both `main` and the tag are pushed under explicit user authorization.
  Checkpoint 65 remains incomplete. No DMG, ZIP, hosted CI run, Apple Developer ID signing,
  notarization, GitHub Release, promotion, or publication ran.
- Completed Checkpoint 65 under ADR 057. WriteLLM now uses BlockNote native Inline Math as a
  bounded atomic inline node while retaining application-owned display Math and Mermaid through a
  Renderer-only `displayMath` alias. Schema v4 and migration 0037 preserve revision history and
  relations while advancing active heads; prose counts, search, replacement, readable citations,
  and quick actions do not expose or cross formulas; Agent reads use `$source$` and typed section
  mutations may preserve or create the strict node. Markdown/LaTeX import and
  Markdown/DOCX/PDF/LaTeX output now carry inline formulas with safe readable loss fallbacks and
  untrusted bounded KaTeX. Frozen install, both zero-advisory audits, 112 focused tests, all 26
  recovery fixtures, `check`, `check:fast`, 198 Electron-hosted files / 1097 tests with three
  benchmark skips plus production build, and the fresh-build 44/44 serial Real-Electron manifest
  passed. No package/release action, hosted CI, commit, tag, push, signing, notarization,
  promotion, or publication ran.
- Accepted ADR 059 and completed Checkpoint 67. True first launches now enter a
  fully optional Welcome → Agent → Embedding → Reranking → MinerU → Create Project flow beneath
  the global Menubar. Versioned Main-owned application state resumes an interrupted step and
  suppresses completed or upgraded installs; existing provider workspaces and the native
  project-creation authority remain unchanged. Seventeen focused tests, `check:fast`, 199
  Electron-hosted files / 1102 tests with three intentional benchmark skips plus production build,
  and the fresh 45/45 Real-Electron manifest passed. Desktop visual inspection,
  scoped Impeccable, and diff checks also passed. No migration, dependency, package/release action,
  hosted CI, commit, tag, push, signing, notarization, promotion, or publication ran.
- Accepted ADR 060 and completed Checkpoint 68. BlockNote native `mathBlock` now joins the native
  Inline Math model, while the application-owned Mermaid implementation moves to a schema-v5
  plain-content `diagram` using `SourceBlockWithPreview` and shared caption/alt-text metadata.
  Migration 0038 preserves historical revisions and relationships while advancing active heads;
  prose operations isolate source, Agent contract v9 creates and preserves both rich blocks, and
  Markdown/LaTeX import plus Markdown/DOCX/PDF/LaTeX output use the converged projection with safe
  fallbacks. Frozen install, zero-advisory production/full audits, focused coverage, `check`,
  `check:fast`, 200 Electron-hosted files / 1107 tests with three intentional benchmark skips plus
  production build, all 27 recovery fixtures from 25 sources, and the fresh 45/45 Real-Electron
  manifest passed. Theme, metadata, malicious source, sanitized SVG, no-caption, reopen,
  and export behavior were verified. No package/release action, hosted CI, commit, tag, push,
  signing, notarization, promotion, or publication ran.
- Built and prepared the separately authorized local `0.2026.8.22` candidate for the completed
  Checkpoints 67–68 baseline. Release metadata advanced, and the packaged smoke was aligned with
  the accepted first-run onboarding and schema-v5 reopen contracts. The no-identity macOS arm64
  package gate verified Electron 43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all
  27 recovery fixtures from 25 sources, all 12 packaged smoke scenarios, and 32/32 packaged E2E
  scenarios. It produced the unpacked App, a structurally verified 239,631,663-byte DMG with
  SHA-256 `3b1065b49ac8ba8441a6806af2913f8cac6afe09d33623cbf0e51b30925db5f6`, and a
  237,780,129-byte ZIP with SHA-256
  `e2540db54181abeef67c3effddebb5b86a39a54ed62e323fcafb2c60b9173101` from the clean annotated
  `v0.2026.8.22` source commit. No push, hosted CI, Apple Developer ID signing, notarization,
  GitHub Release, promotion, or publication ran.

## 2026-08-25

- Accepted ADR 064 and completed Checkpoint 72. Compaction now treats re-readable writing-tool
  bodies as disposable observations, retains exhaustive typed continuation facts, deduplicates
  Knowledge revisions and used citations, and validates the final escaped prompt character and
  token budgets before provider work. Superseded compaction failures no longer remain active in
  the Renderer. The 415-event / 1.5 MB field-scale fixture, 104 focused tests, `check:fast`, the
  1,137-test full Electron suite, production build, and fresh 46/46 Real-Electron E2E manifest
  passed. Raw events and payload-v3 compatibility remain unchanged; no package, release, commit,
  tag, push, signing, or publication action ran.
- Built and prepared the separately authorized local `0.2026.8.25` candidate for the completed
  Checkpoint 71 baseline. Release metadata advanced, and the protected Agent recovery source digest
  was refreshed after its compaction and continuation fixture changed. The no-identity macOS arm64
  unpacked package gate verified Electron 43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR
  entries, all 27 recovery fixtures from 25 sources, all 12 packaged smoke scenarios, and 33/33
  packaged E2E scenarios with no flaky, skipped, or failed scenario. It produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app` from clean annotated source commit `456e837`. No DMG,
  ZIP, hosted CI, Apple Developer ID signing, notarization, GitHub Release, promotion, or
  publication ran.
- Accepted ADR 063 and started Checkpoint 71 to replace the fixed 240-event compaction ceiling with
  bounded complete-run scanning, finalize pathological writing tool loops, and recover exact
  authorized continuations after early Pi settlement. No migration, release, or hosted action is
  authorized by this checkpoint.
- Completed Checkpoint 71 under ADR 063. Compaction now pages safe projections through complete run
  boundaries with model-budget and 2,000-event fail-closed limits; the 415-event field regression
  produces continuous v3 material without changing raw history. Runs finalize once without tools
  after 180 durable events, and Pi continuation loss is recovered once or recorded explicitly.
  Focused tests, `check:fast`, the 1,131-test full Electron suite, production build, 46/46 fresh
  E2E, all 27 recovery fixtures, 12/12 packaged smoke, and 33/33 packaged E2E passed. The unsigned
  local package gate produced structurally verified DMG and ZIP artifacts; no release action ran.

## 2026-08-24

- Built and prepared the separately authorized local `0.2026.8.24` candidate for the completed
  Checkpoint 70 baseline. Release metadata advanced, and the protected MinerU/Notebook recovery
  source digest was refreshed after its real Agent tool-loop fixture changed. The no-identity
  macOS arm64 unpacked package gate verified Electron 43.4.1 / ABI 148, arm64 native modules,
  53,287 ASAR entries, all 27 recovery fixtures from 25 sources, all 12 packaged smoke scenarios,
  and 33/33 packaged E2E scenarios with no flaky, skipped, or failed scenario. It produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app` from clean annotated source commit `bc6227a`. No DMG,
  ZIP, hosted CI, Apple Developer ID signing, notarization, GitHub Release, promotion, or
  publication ran.
- Accepted ADR 062 and completed Checkpoint 70. Notebook now uses the shared Pi Agent session
  runtime as a transient selected-source read-only Agent with exact `search_knowledge` and
  `read_citations` authority, Worker/Main profile enforcement, autonomous multi-continuation tool
  use, bounded registered citations, source-epoch in-memory history, and metadata-only model
  requests. The Renderer reuses the writing Agent's two-level model/effort picker and capability
  clamping while keeping Notebook choices project-session-local. Forty-four focused tests,
  `check:fast`, 200 Electron-hosted files / 1123 tests with three benchmark skips plus production
  build, and the fresh 46/46 Real-Electron manifest passed with no flaky, skipped, or failed
  scenario. The real Notebook fixture proved `search_knowledge` → `read_citations` → cited answer,
  exact tool exposure, no `temperature`, citation preview, and project-reopen cleanup. No migration,
  dependency, package/release action, hosted CI, commit, tag, push, signing, notarization, promotion,
  or publication ran.
- Accepted ADR 061 and completed Checkpoint 69. Agent Harness Protocol v10 adds the isolated
  `ask_user` tool, Main-owned indefinite waiting within the original Pi run, exact capability and
  answer validation, cancellation, trusted user-decision delivery, bounded compaction, and
  `awaiting_input` activity without a new table or event type. The Agent composer now uses the
  official shadcn Questionnaire source for accessible multi-step option or freeform answers,
  conversation attention, Stop, and read-only ask/answer history. Exact frozen installation,
  168 focused tests plus the two-test prompt-budget baseline, scoped Impeccable, `check:fast`, 200
  Electron-hosted files / 1118 tests with three benchmark skips plus production build, and the
  fresh 46/46 Real-Electron manifest passed with no flaky, skipped, or failed scenario, including
  Stop and restart-only historical recovery. No package/release action, hosted CI, commit, tag,
  push, signing, notarization, promotion, or publication ran.
- Built and prepared the separately authorized local `0.2026.8.23` candidate for the completed
  Checkpoint 69 baseline. The first package attempt correctly stopped before packaging because the
  changed Agent recovery source needed a refreshed protected-fixture digest; all 27 fixtures from
  25 sources then passed before the annotated tag was moved to the clean fix commit `ecfca0b`.
  The no-identity macOS arm64 unpacked package gate verified Electron 43.4.1 / ABI 148, arm64
  native modules, 53,287 ASAR entries, all 12 packaged smoke scenarios, and 33/33 packaged E2E
  scenarios with no flaky, skipped, or failed scenario. It produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app`. No DMG, ZIP, push, hosted CI, Apple Developer ID
  signing, notarization, GitHub Release, promotion, or publication ran.

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

- Completed the authorized Checkpoint 75 LM Studio union-schema compatibility maintenance after a
  real run exposed 370 empty `read_section` calls from the earlier empty object-root wrapper. Root
  unions now project their complete property vocabulary, common required fields, and merged literal
  discriminators at the model-visible object root while retaining exact branches under `allOf`.
  The change passed 44 focused tests, `check:fast`, 201 Electron-hosted files / 1,160 tests with
  three intentional benchmark skips, the fresh 47/47 E2E manifest, and the complete no-identity
  package gate with 27 recovery cases from 25 sources, 53,287 ASAR entries, 12 packaged smoke
  scenarios, and 34/34 packaged E2E scenarios. The gate produced a trial App, DMG, and ZIP under
  `dist/macos-arm64`; no commit, tag, push, hosted CI, signing, notarization, release, promotion, or
  publication ran.
- Built the current dirty macOS arm64 maintenance source through the complete no-identity package
  gate after expanding Provider HTTP endpoint support. Electron 43.4.1 / ABI 148, arm64 native
  modules, 53,287 ASAR entries, all 27 recovery cases from 25 sources, all 12 packaged smoke
  scenarios, and 34/34 packaged E2E scenarios passed with no flaky, skipped, or failed scenario.
  The gate produced the App, DMG, and ZIP under `dist/macos-arm64`; no commit, tag, push, hosted CI,
  Apple Developer ID signing, notarization, promotion, release, or publication ran.
- Expanded the shared Provider Base URL contract so localhost and numeric IPv4 endpoints beginning
  with `10`, `100`, `127`, or `192` may use HTTP. Other remote hosts still require HTTPS, embedded
  URL credentials remain rejected, and the Settings guidance now states the accepted prefixes.
  Focused Provider contract tests cover each accepted prefix and rejection of other HTTP hosts.
- Built the separately authorized local Checkpoint 75 macOS arm64 App from the current dirty
  worktree. The first gate correctly stopped because CP75 had intentionally changed a protected
  Agent recovery source; its manifest digest was refreshed and all 27 cases from 25 sources then
  verified. The no-identity package gate verified Electron 43.4.1 / ABI 148, arm64 native modules,
  53,287 ASAR entries, 12/12 packaged smoke scenarios, and 34/34 packaged E2E scenarios, and
  produced the App, DMG, and ZIP under `dist/macos-arm64`. No candidate, commit, tag, push, hosted
  CI, Apple Developer ID signing, notarization, release, promotion, or publication ran.
- Accepted ADR 067 and completed Checkpoint 75. Agent Harness Protocol v12 centralizes shared
  operating rules, shortens model-visible descriptions, starts writing runs with nine core tools,
  and adds seven run-local capability groups activated through the isolated
  `activate_tool_groups` contract. Main and Worker enforce the same active set, exact tool-envelope
  budgets follow every continuation and recovery path, and all OpenAI-compatible parameter schemas
  now expose object roots while retaining union constraints. The strict loopback Harness covered
  LM Studio-style schema validation. 153 focused tests plus the prompt-budget baseline,
  `check:fast`, 201 Electron-hosted files / 1,158 tests with three intentional benchmark skips and
  production build, and the fresh 47/47 E2E manifest passed. No dependency, migration, UI mode,
  package/release action, commit, tag, push, hosted CI, signing, notarization, promotion, or
  publication ran.
- Accepted ADR 066 and completed Checkpoint 74. Agent Harness Protocol v11 now exposes paged,
  complete-hash-bound table reads plus typed table insertion and ordered edits through a pure
  occupancy transformer and the existing section-proposal revision path. Proposal review derives
  bounded table diffs, and native BlockNote headers remain available without merge/split or color
  controls. Publication assembly v2 preserves header-column, alignment, width, and span semantics;
  Markdown reports GFM losses, PDF emits semantic paged tables, and inert LaTeX emits aligned
  `longtable` output with explicit rowspan fallback. A dedicated Agent scenario also caught and
  fixed unit-span default drift across the BlockNote mutation barrier. Focused tests, `pnpm check`,
  1,152 full Electron tests with three intentional benchmark skips plus production build, fresh
  47/47 E2E, all 27 recovery fixtures, 12/12 packaged smoke scenarios, and 34/34 packaged E2E
  passed. The no-identity macOS arm64 package gate structurally verified local DMG and ZIP
  artifacts. No
  dependency, migration, new authority, release gate, commit, tag, push, hosted CI, Apple signing,
  notarization, promotion, or publication ran.
- Advanced the separately authorized source candidate to `0.2026.8.26` for the completed
  Checkpoints 73–74 snapshot. The user separately authorized committing the pending source,
  creating the matching annotated tag, and pushing `main` plus that tag. Hosted CI, Apple
  Developer ID signing, notarization, GitHub Release creation, promotion, and publication remain
  outside this action.

## 2026-08-30

- Published `WriteLLM 0.2026.8` from immutable tag `v0.2026.8.45` as the public Latest GitHub
  Release after explicit user authorization to distribute unsigned artifacts. Revalidated all
  seven platform packages against their build evidence, attached four renamed evidence files,
  `SHA256SUMS`, and a public unsigned release manifest, then verified 13/13 remote assets in
  uploaded state totaling 1,573,263,711 bytes. Release notes state that Windows and macOS may show
  security warnings because the artifacts are unsigned and not notarized.
- Replaced `pnpm/action-setup` v4 with SHA-pinned v6.0.10 in the tag-only CI and disabled
  release-candidate workflow. GitHub run `33299058552` identified it as the only Action still
  targeting deprecated Node 20; v6.0.10 declares the Node 24 Action runtime, while project commands
  remain pinned to Node 24.15.0.
- Completed Checkpoint 26.9 with immutable `v0.2026.8.45` run `33299058552`. The shared static and
  recovery-fixture gate passed, followed by terminal success for four independent build-only jobs:
  macOS arm64, Windows x64, Linux x64, and macOS x64. Each platform completed native packaging,
  inventory verification, and its own unsigned artifact upload. Four non-expired artifacts totaling
  approximately 1.57 GB are retained through 2026-09-29. Hosted database/E2E tests, signing,
  notarization, promotion, and publication did not run under the accepted narrowed scope.
- Completed a Thermo-Nuclear P0/P1 implementation audit with no P0 finding and three remediated P1
  findings. Writing Skill installation now registers each staging directory before writes and
  compensates prior-generation movement and publication in reverse order with diagnostic errors;
  model-visible Agent schemas reject unsupported roots instead of silently emitting empty
  `properties`; and tag-only CI reuses the canonical release-source verifier before installation
  or platform builds. Evidence passed 23 focused tests, recovery fixtures, Biome, Node and Renderer
  typechecks, 202 Electron-hosted files with 1,163 tests and three intentional benchmark skips, a
  production build, and the macOS arm64 tag-CI build-only package path with verified native
  inventory plus DMG/ZIP artifacts. The local pnpm 11.17.0 wrapper could not satisfy the repository
  `pnpm@12.0.0` pin, so the documented direct canonical runners were used; no package metadata,
  dependency, candidate, commit, tag, push, hosted run, signing, notarization, or publication was
  performed.
- Completed the follow-up Thermo-Nuclear structural remediation. Consolidated duplicated worker
  message/error projection, knowledge-search filters, BlockNote inline-text traversal, and Agent
  model selection; reduced the AgentPanel, WritingWorkspace, provider-settings, and preload entry
  modules to typed facades; separated mutation outline/presentation/storage logic, Agent session
  event/error/history/projection logic, and project history-restore recovery; and split the 3,877-
  and 2,570-line Agent tests into behavior suites with shared fixtures. Updated the recovery-fixture
  manifest to retain source-integrity coverage after the test split. Evidence passed Biome, both
  typechecks, 211 Electron-hosted test files with 1,167 passing tests and three intentional benchmark
  skips, the production build, 47/47 unpackaged Electron E2E scenarios, and the full macOS arm64
  package gate including native inventory, packaged runtime/security smoke, 34/34 packaged E2E
  scenarios, and inspected DMG/ZIP artifacts. The local pnpm 11.17.0 wrapper did not match the
  repository `pnpm@12.0.0` pin, so documented npm/direct canonical runners were used; the package
  gate's incidental lockfile metadata change was removed.

- Retained immutable `v0.2026.8.44` as failed evidence after run `33298003843` exposed a
  five-second macOS x64 timeout in a 600-event rolling-compaction database test. Assigned that
  intentionally heavy test the adjacent case's 60-second budget and passed it independently three
  times. Under the user's revised authorization, narrowed hosted CI to the shared static/fixture
  gate followed by four fail-fast-disabled native build and artifact-upload jobs. Added a
  build-only package mode that retains native preparation, production compilation, signature
  policy, packaged inventory, installer/archive inspection, and evidence while excluding Electron
  database tests, E2E, packaged smoke, and Linux Secret Service setup. Advanced release metadata to
  `0.2026.8.45`. Locally passed `check:fast`, the 27 recovery fixtures, 1,160 Electron tests, fresh
  47/47 full E2E, the full 12-category smoke plus 34/34 packaged E2E package gate, and the separate
  build-only macOS arm64 artifact/inventory path. Hosted confirmation remains required.

- Retained immutable `v0.2026.8.43` as failed evidence after run `33294758154` completed the shared
  gate and both macOS platform pipelines through artifact upload. Windows passed Electron and full
  E2E before hidden-window packaged smoke could not expose Knowledge navigation. Linux passed its
  Electron gate and retried grounded Agent after Enter cleared `/section` without selecting its
  scope; the no-flake policy rejected the platform. Made packaged viewport size deterministic and
  changed section-scope selection to a directly confirmed menu action. Three independent focused
  runs, `check:fast`, 1,160 Electron tests, fresh 47/47 full E2E, all 12 packaged-smoke categories,
  34/34 packaged E2E, and structural DMG/ZIP checks passed; advanced release metadata to
  `0.2026.8.44` pending hosted verification.

- Retained immutable `v0.2026.8.42` as failed evidence after run `33291808264` passed the shared
  gate and every platform's 1,160-test Electron/build gate. Both macOS rows and Linux completed all
  47 E2E scenarios without retries, native packaging, and artifact upload. Windows alone retried
  the section-title wrapping scenario after the test wrote before initial title hydration replaced
  its input with `Untitled Section`; the retry passed, and the no-flake policy correctly failed the
  platform. Added an explicit initial-title wait, passed the focused scenario independently three
  times without retries, `check:fast`, 1,160 Electron tests, fresh 47/47 full E2E, 12 packaged-smoke
  categories, 34/34 packaged E2E, and structural local DMG/ZIP checks; advanced release metadata
  to `0.2026.8.43`.

- Retained immutable `v0.2026.8.41` as failed evidence after run `33289904719` passed the shared
  gate and every platform's 1,160-test Electron/build gate. macOS arm64 completed E2E, packaging,
  and artifact upload; macOS x64 exposed clarification-keyboard and context-menu remount races,
  Windows exposed slow packaged-shell navigation after 47/47 E2E, and Linux exposed slash-menu
  opening after its retry passed. Routed keyboard actions through their locator, retried only until
  the intended Agent menu state became visible, and polled packaged Knowledge readiness. Passed
  both focused scenarios, `check:fast`, 1,160 Electron tests, fresh 47/47 full E2E, 12 packaged
  smoke categories, 34/34 packaged E2E, and structural local DMG/ZIP checks; advanced release
  metadata to `0.2026.8.42`.

- Retained immutable `v0.2026.8.40` as failed evidence after run `33287098513` passed the shared
  gate and every platform's 1,160-test Electron/build gate. macOS arm64 and Linux completed all 47
  scenarios, native packaging, and artifact upload. The strict evidence policy rejected one
  macOS x64 model-picker opening retry and one Windows assertion against a transient KaTeX internal
  node despite visibly rendered formulas. Added a bounded popover-open retry and asserted the
  user-visible formula preview, then passed both focused scenarios, `check:fast`, 1,160 Electron
  tests, fresh 47/47 full E2E, 12 packaged-smoke categories, 34/34 packaged E2E, and structural
  local DMG/ZIP checks; advanced release metadata to `0.2026.8.41`.

- Retained immutable `v0.2026.8.39` as failed evidence after run `33283260551` passed the shared
  gate and every platform's 1,160-test Electron/build gate. macOS arm64 completed E2E, native
  packaging, and artifact upload; Windows and Linux passed their full 47-scenario suites before
  separate packaged-smoke and packaged-E2E races, while macOS x64 exposed a transient duplicate
  during streaming-to-persisted Agent response settlement. Added exact settlement waits at all
  three boundaries, passed 1,160 Electron tests, fresh 47/47 full E2E, 12 packaged-smoke
  categories, 34/34 packaged E2E, recovery/static gates, and structural local DMG/ZIP checks, and
  advanced release metadata to `0.2026.8.40`.

- Retained immutable `v0.2026.8.38` as failed evidence after run `33281622771` passed static and
  every platform's complete Electron/build gate, then reproduced Floating UI's virtual
  position-reference loop on Windows, Linux, and both macOS targets. The independent jobs also
  exposed bounded setup, materialization, dropdown-close, layout-settle, and menu-remount races.
  Kept the virtual reference stable while delegating to live geometry callbacks, added explicit
  state waits at those hosted boundaries, passed 1,160 Electron tests, a production build, all 47
  E2E scenarios without retries, static/type and recovery-fixture gates, and advanced release
  metadata to `0.2026.8.39`.

- Retained immutable `v0.2026.8.37` as failed evidence after run `33279820297` proved complete
  independent native packaging and artifact upload on both macOS targets. Windows and Linux
  reproduced the same repeated BlockNote/Floating UI DOM-reference loop; Windows also exposed a
  duplicate final-response locator, while Linux traces proved two full scenarios reached their
  final action at about 88 seconds before the 90-second test budget expired. Deduplicated DOM
  reference application, selected the final response explicitly, assigned 180-second budgets only
  to those two long scenarios, refreshed recovery evidence, and advanced release metadata to
  `0.2026.8.38`.

## 2026-08-29

- Retained immutable `v0.2026.8.36` as failed evidence after run `33278248512` confirmed the
  Windows patch-EOL and Linux real-process credential fixes, passed macOS x64, and exposed one
  Windows Floating UI setter loop plus one macOS arm64 conflict-test race. Stored current setters
  in stable React refs, made the conflict stimulus deterministic, and passed the affected E2E
  scenarios repeatedly after a fresh frozen install and build. The final gate passed 1,160 Electron
  tests, the production build, and all 47 E2E scenarios without retries. Replaced the globally
  coupled validation/package matrices with four independent per-platform pipelines after one
  shared static gate, so a platform failure no longer suppresses package work on the others;
  advanced release metadata to `0.2026.8.37`.

- Retained immutable `v0.2026.8.35` as failed evidence after run `33277302371` passed static,
  credential preflight, both macOS rows, and the Linux Electron/build gate but exposed Windows
  patch CRLF conversion and Playwright 1.62.1 overriding Linux E2E with
  `--password-store=basic`. Forced LF checkout for dependency patches and pinned Playwright's
  default off only for the explicit hosted `gnome-libsecret` session. A fresh frozen install
  applied both patches; static/type, fixture, loader syntax, and affected E2E checks passed; advanced
  release metadata to `0.2026.8.36`.

- Retained immutable `v0.2026.8.34` as failed evidence after run `33274815298` passed static,
  credential preflight, macOS arm64, and all 1,160 Windows Electron tests but exposed two Windows
  Renderer/selection E2E failures, one macOS x64 five-second stress-test timeout, and Linux
  real-process credential rejection followed by teardown exhaustion. Added the focused test budget,
  explicit cross-platform selection, a pinned BlockNote stable-ref patch, hosted GNOME desktop
  discovery, and immediate bounded Linux probe diagnostics. Passed 1,160 Electron tests, the
  production build, static/type checks, and both affected E2E scenarios; advanced release metadata
  to `0.2026.8.35`.

- Retained immutable `v0.2026.8.33` as failed evidence after run `33264429276` passed static,
  credential preflight, and both macOS rows but left three Windows stress-test budgets and 17 Linux
  credential-backed scenarios. Raised only those three Windows budgets to 60 seconds. Separated the
  isolated Linux Electron preflight from delegated E2E/package commands and made every real
  Playwright process validate its own switch, backend, availability, and encrypted round trip.
  Passed 39 focused Electron tests, two focused E2E scenarios, static/type checks, and recovery
  fixtures; advanced release metadata to `0.2026.8.34`.
- Retained immutable `v0.2026.8.32` as failed evidence after run `33262923466` passed static, Linux
  credential preflight, and macOS x64 but exposed systemic hosted Windows Vitest budgets and one
  collapsed BlockNote quick-action selection on macOS arm64. Added a Windows-CI-only 30-second test
  budget, matched the retention-heavy mutation test, made the quick-action keyboard range explicit,
  and replaced a remounting editor `blur()` with stable title-input focus in the prior Windows
  citation failure. Passed 159 focused Electron tests, both focused E2E scenarios, static checks,
  and recovery fixtures; advanced release metadata to `0.2026.8.33`.
- Started immutable `v0.2026.8.31` run `33261730182`; static, Linux credential preflight, and both
  macOS Electron/E2E rows passed. Correlated the complete `.30` Linux diagnostics with the wrapper:
  its standalone safeStorage probe destroyed one temporary X server before E2E opened another,
  causing the application to fall back from `gnome_libsecret` to `basic_text`. Moved probe and
  delegated commands into one DBus/Xvfb/keyring lifetime, removed nested workflow Xvfb calls, gave
  only the proven long workspace-reopen scenario a 180-second budget, passed 1,160 Electron tests,
  production build, focused E2E, static checks, and recovery fixtures, and advanced release metadata
  to `0.2026.8.32`.
- Retained immutable `v0.2026.8.30` as failed evidence after run `33259908430` passed static and
  credential preflight gates but exposed two macOS test budgets, one macOS E2E retry, and Windows
  CRLF, floating-control, native layout, rendering-delay, and editor-focus boundaries. Normalized
  Writing Skill CRLF bodies before Pi comparison, hardened only the affected tests/interactions,
  passed 79 focused Electron tests, a fresh build, and seven focused E2E scenarios without flakes,
  advanced release metadata to `0.2026.8.31`, and prepared the next immutable candidate.
- Retained immutable `v0.2026.8.29` as failed evidence after run `33259789028` rejected the changed
  manuscript-export test's stale recovery-manifest digest before starting the platform matrix.
  Local verification also identified the changed Agent session test digest. Updated both manifest
  entries to their normalized source SHA-256 values, advanced release metadata to
  `0.2026.8.30`, and prepared a corrected immutable candidate; no failed tag was moved or rerun.
- Advanced release metadata to `0.2026.8.29` after the user authorized committing and pushing the
  locally verified `.28` portability remediation and publishing a fresh immutable tag. The tag may
  run only the unsigned four-platform build; signing, promotion, and GitHub Release publication
  remain excluded.
- Diagnosed immutable `v0.2026.8.28` run `33247497461`: static verification passed, then Linux
  exposed an overlong multibyte filename, Windows exposed retained SQLite test handles and two
  five-second test-budget overruns, and hosted macOS exposed two 45-second complete-scenario
  overruns before packaging. Remediated only those portability boundaries. All 71 focused
  Electron tests, both affected Real-Electron scenarios under `CI=true`, a fresh production build,
  `check:fast`, and diff checks passed locally. No replacement commit, tag, push, signing,
  promotion, or publication was performed.
- Retained immutable `v0.2026.8.27` as failed hosted evidence after run `33247388140` stopped at
  the static frozen install: pnpm 12 correctly required its new package-manager dependency lock
  metadata. Regenerated the lockfile with pnpm 12, advanced release metadata to `0.2026.8.28`, and
  prepared a new immutable tag rather than moving `.27`.
- Advanced release metadata to `0.2026.8.27` for the completed Checkpoint 75 and tag-only
  cross-platform CI restoration snapshot. The user authorized committing the pending source,
  creating the annotated `v0.2026.8.27` tag, and pushing `main` plus that tag. The tag may start
  the unsigned four-platform build; signing, release promotion, and publication remain excluded.
- Resumed Checkpoint 26.9 under explicit user authorization after the repository became public.
  Restored the unsigned cross-platform CI definition with Windows x64, macOS arm64, macOS x64, and
  Linux x64 native test, E2E, and package rows, and constrained the entire workflow to pushed tags.
  Pull requests, branch pushes, schedules, and manual dispatches do not trigger it. The protected
  release-candidate workflow remains disabled; no hosted run, signing, promotion, or publication
  result is claimed by the local configuration change.
- Accepted ADR 068 and started Phase 25 Checkpoint 76 under explicit user authorization. The
  checkpoint keeps `writing` and `notebook_knowledge` as the outer profiles, adds sticky Ask, Plan,
  and Write ceilings with immutable run snapshots, advances the Agent Harness to Protocol v13, and
  places the mode selector beside Send. Checkpoint 77 Writing Task v2 remains paused pending
  separate authorization.
- Completed Phase 25 Checkpoint 76 without entering Checkpoint 77. Migration 0039 persists sticky
  Ask, Plan, and Write selection with Write defaults; Protocol v13 carries an immutable run mode;
  shared ModePolicy enforcement bounds Worker advertisement and Main execution; and the shadcn
  composer selector keeps Approval orthogonal. Direct Biome and
  Node/Renderer typechecks, all 1,179 Electron-hosted tests, the production build, all 47 Electron
  Playwright scenarios, and `git diff --check` passed. No package, signing, notarization, release,
  commit, tag, or push action was performed.
- Aligned the repository package-manager declaration from pnpm 12.0.0 to the installed and
  user-approved pnpm 11.17.0 in both `packageManager` and `engines.pnpm`. Removed pnpm 12's
  package-manager bootstrap document from `pnpm-lock.yaml`; pnpm 11.17.0 then accepted the
  remaining dependency lock under `--frozen-lockfile`. The refreshed CP76 verification totals
  1,180 Electron-hosted tests with three benchmark skips, and `check:fast` passes when only the
  host Node 26 versus repository Node 24 engine mismatch is bypassed.
- Built a separately authorized local trial package for the completed Checkpoint 76 work. Refreshed
  the recovery fixture hashes for the three intentionally changed Agent test sources, then passed
  the no-identity macOS arm64 package gate with 31 recovery fixtures, 12 packaged smoke scenarios,
  and 34/34 packaged Electron scenarios. Produced structurally verified unsigned DMG and ZIP
  artifacts for `0.2026.8.45`; no signing, notarization, release, commit, tag, or push followed.
- Completed Agent model-selection recovery maintenance. Provider settings publish a Renderer-local
  invalidation that makes an open Agent panel re-read Main's bounded catalog snapshot, New
  conversation performs the same refresh defensively, and a stale project-local model reference
  now exposes an explicit available-model picker without silently rewriting conversation history.
  Three focused Renderer tests, `check:fast`, the production build, and the focused
  `agent.grounded-proposal-workflow` and `agent.table-authoring-publication` Electron scenarios
  passed; no persistence, preload, IPC, Agent protocol, package, release, commit, tag, or push
  action was performed.
- Completed generated-image lifecycle maintenance. Main now terminalizes a `generating` proposal
  when the generated asset cannot pass the later editor barrier, insertion metadata validation,
  manuscript application, or image-iteration publication, publishes the failed state, and records
  a safe failure reason. Because ADR 006 makes image work request-scoped rather than a durable job,
  project-session startup also converts generations left active by a prior app lifetime to failed;
  this repairs existing orphan rows instead of merely hiding them in the Renderer. Main also keeps
  the complete 2,000-character alternative text while bounding only the derived BlockNote image
  name to 500 characters, so the reported 501-character metadata case applies successfully. The
  focused image suite passed 11/11 tests, including long metadata, post-generation publication
  failure, and service-recreation recovery. `check:fast`, all 1,186 Electron tests with three
  benchmark skips, the production build, and `git diff --check` passed; no migration, preload,
  IPC, Agent protocol, package, release, commit, tag, or push action was performed.
- Built the user-requested post-fix macOS arm64 test application from dirty source revision
  `bc2f0bf926397f632bac577d039d4205f5b0183a`. The complete no-identity package gate verified 31
  recovery fixtures from 29 sources, 53,288 ASAR entries, arm64 Electron ABI 148 native modules,
  a no-Team-ID ad-hoc/linker signature, all 12 packaged smoke scenarios, and all 34 packaged
  Electron scenarios with no flaky, skipped, or failed scenario. It produced the unpacked App,
  238,734,583-byte DMG (`efd9e480b4c63c20da468640adbfa5c30a27969e794584fc93bc7422c58eeb66`),
  and 236,882,652-byte ZIP (`54f64cf2acd5ede85b1e80cc4364999038efd9fe53792698729f49329ac9865a`).
  No Developer ID signing, notarization, release, commit, tag, push, promotion, or publication was
  performed.
- Completed Gemini/Vertex `read_section` compatibility maintenance from the reported real-app
  failure. Safe durable event evidence showed ten failures across three runs, all generated as
  blockless canonical reads; hash comparison confirmed `view: "canonical"` without reading or
  persisting raw private arguments. The affected run recovered by issuing four summary reads, but
  consumed one avoidable continuation with 18,275 input and 374 output tokens. Clarified that
  summary is the whole-section text/page mode and added the single ADR 042-compatible Worker shim
  that maps only a blockless canonical request to summary before Pi validation. Canonical reads
  with an exact `blockId`, every other malformed call, and Main validation remain unchanged. The
  two focused suites passed 37 tests; `check:fast` passed; and `check:electron` passed 215 files / 3
  skipped benchmark files, 1,187 tests / 3 skipped benchmark tests, plus the production build. No
  live billable Vertex request, dependency, migration, package, release, commit, tag, or push action
  was performed.
- Completed read-section activity presentation maintenance. Finished groups remain summary-first
  and collapsed by default; expanding a group now displays `Read · <section title>` for each
  successful read, with the title parsed from Main's validated `read_section` result rather than
  model arguments or narration. No section ID or block ID is shown, while running, failed,
  stopped, and legacy malformed results keep the safe generic label. The focused Renderer suite
  passed 32 tests, `check:fast` passed, `check:electron` passed 215 files / 3 skipped benchmark
  files and 1,189 tests / 3 skipped benchmark tests plus the production build, and the Impeccable
  detector reported no findings. No IPC, persistence, protocol, package, release, commit, tag, or
  push action was performed.
- Built the user-requested Gemini/Vertex read-section trial application from dirty source revision
  `bc2f0bf926397f632bac577d039d4205f5b0183a`. The complete no-identity macOS arm64 package gate
  verified 31 recovery fixtures from 29 sources, 53,288 ASAR entries, Electron 43.4.1 / ABI 148
  arm64 native resources, all 12 packaged smoke scenarios, and all 34 packaged Electron scenarios
  with no flaky, skipped, or failed scenario. It produced the unpacked App, a 238,736,237-byte DMG
  (`02f11feb8c382d5587d2550c488d51d8402d53df7ddd1279615840296219275a`), and a
  236,885,312-byte ZIP
  (`33c6ddc043600710a09469ebb156967829149b9ea0b157484274d156f336ea91`). No Developer ID
  signing, notarization, release, commit, tag, push, promotion, or publication was performed.
- Completed Agent context-compaction status presentation maintenance. Timeline projection now
  removes a matching historical start marker after a final successful checkpoint or failure, while
  retaining the live marker across non-final rolling checkpoints. This prevents the completed
  outcome and a stale `Summarizing earlier conversation…` spinner from appearing together. The
  focused Agent Renderer suites passed 49 tests; Renderer typechecking, Biome, and `git diff
  --check` passed. The combined `check:fast` gate reached and passed Biome, then remained blocked by
  the unrelated dirty `session-service.tools.test.ts` fixture missing its required `blockType`.
  No persistence, IPC, protocol, package, release, commit, tag, or push action was performed.

## 2026-08-31

- Completed Phase 27 Checkpoint 78 under ADR 070. Added project-authoritative stable Reference
  metadata, one bounded user-selected Zotero/Better BibTeX connector, explicit attachment review,
  bilingual citekey clusters and legacy conversion, evidence-bound Agent citations, background CSL
  formatting, metadata-first Knowledge management, and deterministic CSL-JSON/BibTeX/Pandoc and
  bibliography-aware publication paths without changing the rebuildable RAG index. The final
  canonical suite passed 1,228 tests with three benchmark skips; all 47 fresh Electron E2E
  scenarios passed; and the no-Team-ID macOS arm64 package gate passed 31 recovery fixtures,
  53,318 ASAR entries, 12 packaged smoke scenarios, and 34 packaged E2E scenarios. Frozen install,
  production/full zero-advisory audits, license/notices review, scoped Impeccable detection, and
  diff checks passed. Windows/Linux watcher runtime behavior remains unclaimed. No signing,
  notarization, release, commit, tag, push, hosted CI, promotion, or publication was performed.

- Built, verified, committed, tagged, and pushed candidate `v0.2026.8.47` for completed Checkpoint
  76.1. The complete no-Team-ID macOS arm64 package gate verified 31 recovery fixtures from 29
  sources, Electron 43.4.1 / ABI 148 native resources, 53,288 ASAR entries, all 12 packaged smoke
  scenarios, and all 34 packaged E2E scenarios without flakes, skips, or failures. It produced a
  238,730,171-byte DMG (`1bec8665de8a6dba930da675de950a4fdbfe389fb289813cb1a1c68d507be1e9`)
  and a 236,896,362-byte ZIP
  (`d6bc755e29934735b9a51f642dc49a7390f5d8fa6f0edd171b9d928aeede2081`). Clean commit
  `7bb8552741c461b01e08047f0b710b1a595ea03d` passed exact release-source verification; annotated
  tag `v0.2026.8.47` and `main` were atomically pushed to GitHub, starting tag-only run
  `33345029753`. No Developer ID signing, notarization, GitHub Release creation, promotion, or
  publication was performed.
- Completed Phase 26 Checkpoint 76.1 under ADR 069. Project SQLite now permanently retains
  content-addressed model-visible harness context, exact Pi provider bodies, structured provider
  responses, raw invalid tool attempts, injected Skill sources, compaction evidence, titles, and
  Agent image metadata. Every traced provider attempt waits for Main's transactional persistence
  ACK before network dispatch; retries and correlation identifiers remain explicit across process
  boundaries, while ordinary logs retain only safe metadata. SQL views reconstruct request JSON
  and merge traces with authoritative Agent events; legacy requests remain explicitly unavailable.
  A 7,936,308-byte repeated-history sample stored 330,580 payload bytes after deduplication
  (95.83% reduction) and reconstructed 12 requests in about 1.73 seconds. `check:fast`, 1,204
  canonical tests with three benchmark skips, the Electron/build gate, all 47 fresh E2E scenarios,
  and the complete no-Team-ID package gate with 12 smoke and 34 packaged E2E scenarios passed. No
  release signing, notarization, commit, tag, push, promotion, or publication was performed.
- Built the separately authorized local `v0.2026.8.46` candidate after aligning tag CI with the
  accepted pnpm 11.17.0 runtime. `check:fast`, 31 recovery fixtures from 29 sources, 1,194
  Electron-hosted tests with three benchmark skips plus the production build, and all 47 fresh
  Electron E2E scenarios passed. The complete no-identity macOS arm64 package gate verified
  Electron 43.4.1 / ABI 148, 53,288 ASAR entries, all 12 packaged smoke scenarios, and all 34
  packaged Electron scenarios without flakes, skips, or failures. It produced a 238,735,121-byte
  DMG (`45e37ea91cb07e945014695d89cbc51cd966570216a925567b664f6cf01b20cc`) and a
  236,883,926-byte ZIP (`3120c4ac9a63c2763f918129de0ee86c9f5a0bf8a74c68828e53c77330d13fd3`).
  Source commit `1f53c5c` and annotated tag `v0.2026.8.46` passed the exact release-source verifier
  and were atomically pushed to GitHub; tag-only four-platform run `33341907788` started
  successfully. Developer ID signing, notarization, GitHub Release creation, promotion, and
  publication remain outside the authorization.

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

- Completed Phase 28 Checkpoint 79 under ADR 070. Zotero/Better BibTeX import now uses one bounded,
  Reference-first prepare/confirm flow with explicit PDF-query consent, citation-only import,
  primary and supplementary attachment selection, user-selected completion of incomplete
  References, and explicit `relink_required` recovery. Bibliography PDFs continue through the
  existing Knowledge copy/hash/parse pipeline without leaving orphan `doc-*` References, while
  cross-Reference PDF ownership fails closed. No database migration, RAG, embedding, or
  `index.sqlite` change was introduced.
- `pnpm check:fast` passed. The canonical Electron suite passed 1,232 tests with three benchmark
  skips and the production build succeeded. All 48 fresh Electron E2E scenarios passed, including
  the unified `.bib` plus relative-PDF import fixture; the scoped Impeccable detector and
  `git diff --check` passed. No package, release, commit, tag, push, signing, notarization,
  promotion, or publication action was performed.
- Completed Agent Reference citation projection maintenance. The production Agent read-tool
  composition now injects the project Reference authority, making `search_knowledge` and
  `read_citations` expose the linked project citekey, title, authors, venue, and year. Earlier
  `doc-*` tokens caused by the missing injection can resolve source provenance through the exact
  Knowledge UUID encoded in the token when that Knowledge item is linked to a Reference; the
  resolver still performs no fuzzy metadata matching or manuscript rewrite. Focused coverage
  passed 19 tests; `check:fast` passed; and the Electron gate passed 1,234 tests with three
  benchmark skips plus the production build. No migration, RAG/index change, package, release,
  commit, tag, or push action was performed.
- Built the user-requested Agent Reference citation-fix trial App from dirty source revision
  `f46c37164faffdae08332920e27ab144917145e2`. The complete no-Team-ID macOS arm64 package gate
  verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries, all 12 packaged runtime smoke
  scenarios, and all 34 packaged Electron scenarios without flakes, skips, or failures. It
  produced a 239,024,594-byte DMG
  (`f7aaa1cacc0c7d3df45b0acf18bc69c4eab5c30c2d3939f8c62a5034fb3028b0`) and a
  237,205,233-byte ZIP
  (`f1e17f0a700ba6928bacc8fb0cdf9568ee277cbbd8c459abb0711cfc63b8f604`). No Developer ID
  signing, notarization, release, commit, tag, push, promotion, or publication was performed.
- Completed the Reference citekey migration audit and maintenance. Citation Coverage now matches
  canonical English and Chinese citation clusters by exact project citekey, exposes Reference
  identity in its contract, search, and UI, and invalidates paging snapshots when relevant
  Reference metadata or links change. Draft availability and unused-resource checks now map
  canonical keys through the immutable Reference projection; Agent Knowledge reads no longer
  manufacture an unregistered `doc-*` key when Reference linkage is unavailable. Citation-click
  resolution prefers exact citekey, followed by a unique legacy Reference title, then the narrow
  historical filename or encoded-Knowledge-UUID compatibility paths. Publication legacy
  availability uses the same evidence-backed Reference-title boundary. Focused suites passed 62
  tests, `check:fast` passed, the complete Electron suite and production build passed, the scoped
  Impeccable detector returned no findings, and `git diff --check` passed. No schema, RAG/index,
  dependency, package, release, commit, tag, or push action was performed.

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

- Completed Phase 29 Checkpoint 80 under ADR 071. Agent `Try again` no longer resubmits prompt text:
  transient failures before content expose `Retry request`, interrupted streams expose `Continue`,
  and both restore the exact live Pi request boundary through a one-use Main-authorized capability.
  Each click creates a new immutable `model_request` and durable schema-v4 `model_retry` lineage;
  the original user message and failed request remain singular and unchanged.
- The Worker retains only the latest in-memory retry anchor, validates its canonical context
  fingerprint before network I/O, preserves the five-attempt provider budget per logical request,
  holds queued Follow-ups behind a retry barrier, blocks Steer injection, and never reconstructs
  retry authority from diagnostic traces or after restart. Partial output remains a separate
  interrupted assistant event and completed tools are not replayed.
- `pnpm check:fast` passed. The canonical Electron gate passed 228 files and 1,240 tests with three
  benchmark skips, followed by a successful production build. The focused real-Electron retry
  scenario proved exact request-body reuse and one durable user message for both before-content
  and interrupted-stream failures; all 49 fresh Electron E2E scenarios passed without flakes,
  skips, or failures. `git diff --check` passed. No package, release, commit, tag, push, signing,
  notarization, promotion, or publication action was performed.
- Built and fully verified the user-requested no-Team-ID macOS arm64 App from the completed CP80
  dirty source state. The package gate verified 31 recovery fixtures from 29 sources, 53,318 ASAR
  entries, Electron 43.4.1 / ABI 148 arm64 native resources, all 12 packaged runtime smoke
  scenarios, and all 34 packaged Electron scenarios without flakes, skips, or failures. It
  produced `WriteLLM-0.2026.8.49-arm64.dmg` (239,009,276 bytes,
  `438ca43b6d2416321f5544084e13120d34d37f0405ec31e254b88666b717e6c6`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,206,436 bytes,
  `ae0e28f2ecc249739f8d1369ad4b940e82638f402f46057f6bc96d4bd92cda77`) under
  `dist/macos-arm64`. No Developer ID signing, notarization, release, commit, tag, push, promotion,
  or publication action was performed.
- Completed the Renderer-only non-blocking tool-failure presentation maintenance. Pre-dispatch
  failures now occupy one quiet expandable timeline row instead of a full destructive alert; the
  expanded view retains the bounded tool name, error code, message, validation paths, and duration.
  Focused Agent Renderer coverage and `check:fast` passed. No protocol, persistence, or authority
  boundary changed.

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

- Implemented the approved build/verification maintenance without changing dependencies, the lock
  file, four native CI platforms, installer formats, tag-only triggers, or release-signing policy.
  Plain builds prepare native modules and compile without typechecking or testing. Composite gates
  own static checks and compile once; `check:full` and `check:package:smoke` provide explicit broader
  and narrower coverage. Ordinary changes default to focused tests, with the selection rules in
  `AGENTS.md` and the verify skill. Existing full/critical/packaged scenario inventories remain.
- Native preparation probes Electron loading and validates architecture, repairing only a mismatch;
  `rebuild:native` remains forceful. The package gate assembles one application, checks and tests it,
  then supplies that same path to `--prepackaged` for installers. Build-only aliases retain resource
  and architecture checks without running Vitest, E2E, or recovery inventory verification.
- Excluded dependency source maps/declarations and better-sqlite3 compiler sources/intermediates.
  Runtime JS, package metadata, licenses, native binaries and resources remain. Removed custom
  ASAR/native hashes and recovery test-source hashes; installer SHA256 and small manifest digests
  remain. Recovery verification checks the declared inventory, not test execution. Release evidence
  derives its expected 31 cases, 29 source files and 14 categories from the actual manifest.
- Shared sequential stage reporting records scope/selection, start, duration, status, exit code and
  signal under ignored `.cache/verification/`, with terminal boundaries and 30-second heartbeats.
  Shared timeout policy preserves platform differences and retries without introducing performance
  failure thresholds. E2E reports include measured attempts; Vitest retry spans are labeled estimates.
  A real retry/skip fixture caught and fixed the reporter's callback-order handling before delivery.
  CI uploads timing JSON even on failure and reports elapsed build wait separately from cumulative
  job runtime; the summary job is excluded from both measurements.
- Focused verification passed: 32 tooling tests across eight files, two timeout/reporter integration
  tests, and all six Trace tests. A final 10-test stage/reporter run took 1.4 seconds. Review also
  corrected report-write failures masking original exits, output overflow misclassified as a signal,
  and interruption between stages; focused tests cover all three. The history/SQL
  rebuild case retains deduplication and per-request reconstruction assertions at 8 histories /
  3 requests (6 ms observed); `benchmark:trace` passes at the original 80 / 12 scale (1.65-second
  test, 2.4-second command; five unrelated tests excluded by its filter). Error exit, missing command,
  signal interruption, forwarding, stage deduplication, all native target argument shapes including
  AppX, builder exclusions, recovery inventory, and release evidence are covered. No product
  regression scenario was removed and no historical flaky scenario was rewritten.
- One complete `pnpm check:package` run passed on macOS arm64 in **187.9 seconds**. It includes
  `check:fast`, inventory, 12 native/runtime smoke scenarios and all 34 packaged E2E scenarios, with
  34 attempts, zero retries, flakes, failures or skips. Runtime coverage includes SQLite/sqlite-vec,
  workers, PDF, Mermaid, formulas, security boundaries and lifecycle logging. The builder log has
  exactly one application-packaging invocation and explicitly skips identity signing; the
  no-Team-ID signature policy passed. The installer phase reuses that verified App.

  | Stage | Local elapsed |
  | --- | ---: |
  | Static checks | 9.0 s |
  | Native preparation + production compile | 11.4 s |
  | Application assembly | 20.8 s |
  | Packaged runtime smoke | 40.0 s |
  | Packaged E2E | 84.6 s |
  | DMG + ZIP from prepackaged App | 21.7 s |
  | Installer hashes | 0.2 s |

- Against the retained previous package, actual ASAR size changed from 495,667,940 to 256,257,975
  bytes (-48.3%). Header file count, including unpacked files but excluding directories, changed
  from 49,252 to 31,942 (-35.1%); total header file bytes changed from 533,408,812 to 277,958,907
  (-47.9%). Source maps changed from 11,019 to zero and declarations from 6,255 to zero; excluded
  SQLite compiler material is absent. DMG changed from 239,031,387 to 194,634,272 bytes (-18.6%);
  ZIP changed from 237,198,426 to 192,544,907 bytes (-18.8%). The earlier local build observation
  was 21.84 seconds including typechecks; the new build is 11.4 seconds with static checks reported
  separately. These are local observations, with different baseline/current source revisions,
  not an identical-source performance experiment or a promise of hosted speedup.
- Evidence: `dist/macos-arm64/package-evidence.json`, the App/DMG/ZIP beside it, and
  `.cache/verification/package-2026-09-02/` containing stage reports, E2E attempts and `comparison.json`.
  Runtime: Electron 43.4.1, embedded Node 24.18.1, ABI 148; host pnpm 11.17.0. Host Node 26.8.1
  retains the existing engine-range warning; the toolchain and pins were preserved. The frozen
  offline install passed without dependency or lock changes. Windows/Linux/macOS Intel runtime
  acceleration remains for the next normally authorized tag CI. No commit, tag, push, remote build,
  Developer ID signing, notarization or publication was performed; starting worktree changes remain.
- Final `pnpm check` and `git diff --check` passed. Only tool/reporting checks were repeated after
  the review fixes; the accepted application and installer contents were unaffected.


## 2026-09-02 Agent Panel presentation maintenance

- Authorization: the user explicitly approved the Agent Panel presentation implementation plan,
  including ADR 075, six content categories, central visibility/disclosure rules, focused tests,
  and desktop verification. ADR 075 records the pinned OpenCode/Codex/Pi source evidence and
  Renderer boundary. No database, IPC, Worker, dependency, Pi pin, or release change was needed.
- `projectAgentPresentation` owns message/activity/change/question/compaction/notice projection,
  tool/result correlation, proposal truth, validated source attribution, run duration, and current
  activity. Timeline and Details share the same result. The static exhaustive tool table replaces
  scattered name switches and proposal-name prefix detection. Successful internal tools remain
  in Details; failures/stops are visible. Read groups retain per-step sources and use elapsed
  wall-clock span for parallel calls. Proposal failures/conflicts remain visible when collapsed.
- Live and durable prose share the same message renderer and stable message keys. Live settlement
  removes the partial and inserts the durable record in one state update; duplicate settlement
  cannot erase the next partial and terminal runs reject late deltas. Background sessions retain
  independent partials. Disclosure stores manual choices by item ID; untouched activities and
  proposals follow lifecycle defaults. Compaction uses one lifecycle row; historical question
  answers are shown once and synthetic answer/approval prompts remain filtered.
- Focused Electron-hosted Renderer verification passed for five files: 77 tests in 1.4 seconds
  (`1788386357077-80103-3c51efc4`). An additional proposal-truth assertion covering outdated,
  applied, undone, conflicted, and failed states brought the view-model file to 45 passing tests
  in 1.0 second (`1788386517302-81483-1af563a9`), for **78 distinct passing tests** overall.
  An earlier 63-test development run had three old-shape assertion failures; those expectations
  were corrected before the passing runs. Tests use the repository's Electron runner, not Node
  Vitest. Electron's non-fatal macOS `task_name_for_pid` diagnostic did not affect results.
- One `pnpm check:e2e` invocation selected agent-writing, agent-clarification, agent-concurrency,
  agent-proposal-refresh, and agent-writing-task. Static checks passed (Biome 0.4 s, main types
  4.6 s, Renderer types 4.9 s), native preparation took 0.6 s, and the **only production build**
  took 11.1 s. Five of six scenarios passed; clarification stopped correctly but its assertion
  expected the old generic message instead of the concrete abort reason. The composite took
  66.7 s, including 44.8 s Playwright; evidence: `1788386377683-80306-82f8d733`.
- Only clarification assertions changed after that build: concrete abort reason, one live
  question, and one historical question/answer. `pnpm test:e2e e2e/agent-clarification.spec.ts`
  passed against the same build in 5.5 s (5.0 s scenario), including restart/read-only history;
  evidence: `1788386513057-81416-cccb44ce`. All **six distinct scenarios** therefore passed;
  seven total attempts, one intentional assertion-fix rerun, zero automatic retries, flakes or
  skips. Production source was unchanged between those E2E invocations.
- Grounded writing also verifies keyboard expansion, preserved manual activity expansion across
  later runs, pending-to-settled proposal defaults, real source titles/pages, native diff modes,
  approvals, undo/reopen, and compaction. Concurrent conversations and proposal refresh retain
  their existing authority assertions. Writing-task verification confirms internal tools are
  absent from the timeline but present in Details, and retains keyboard/task identity checks.
- Scoped Impeccable review: detector returned `[]` for the four changed UI files. The retained
  shadcn primitives expose native disclosure state and keyboard controls; no parallel styles,
  dependencies, or motion were added. Four real 1680×900 desktop screenshots cover collapsed/
  expanded tasks, a sidebar resized to 640 px, and dark mode. Controls and scroll regions remain
  contained and the resize handle works. Images: `.cache/verification/agent-presentation-screenshots/`.

  | Scoped dimension | Score | Evidence / limit |
  | --- | ---: | --- |
  | Accessibility | 3/4 | Keyboard and disclosure ARIA verified; no full screen-reader audit |
  | Performance | 3/4 | Shared memoized projection, bounded details; no performance benchmark |
  | Desktop layout | 4/4 | Geometry, scrolling, keyboard and sidebar resize assertions pass |
  | Theming | 3/4 | Existing tokens and light/dark screenshots; no full contrast measurement |
  | Implementation integrity | 4/4 | Central typed policy and no detector findings |
  | Total | 17/20 | Scoped check passed; no verified P0–P3 issue introduced by this change |

- Reports are under `.cache/verification/` using the IDs above. Runtime was Electron 43.4.1,
  embedded Node 24.18.1 / ABI 148, on macOS arm64. Host Node 26.8.1 retains the pre-existing
  engine warning; exact pnpm 11.17.0 was preserved. Other platforms and full packaging/release
  gates were outside this Renderer maintenance scope. Final `pnpm check` and `git diff --check`
  passed after documentation synchronization.

## 2026-09-02 Agent model configuration and output completion

- Authorization: the user explicitly requested correction of the ignored 65,536-token model
  allowance, discarded manual-model reasoning capability, successful classification of `length`,
  and delayed model configuration refresh. ADR 076 records the decision and supersedes ADR 014's
  manual/custom reasoning exclusion. The paused Writing Task checkpoint remains unchanged.
- The two inspected writing traces sent only 8,192 output tokens, omitted `thinkingConfig` despite
  Thinking being `off`, and ended with `length` after roughly 7,860 reasoning tokens. Read/search
  actions completed, but no section mutation proposal was submitted. The final announcements of
  imminent writing were truncated responses, not successful chapter writes.
- Main now derives runtime identity, reasoning, context limits, output limits, and run provenance
  from one current catalog resolution. Interactive output defaults to the declared model allowance
  within the existing 131,072-token runtime bound; explicit lower budgets remain respected. Legacy
  configurations without metadata retain the 8,192-token fallback. Title and summary budgets retain
  their existing purposes, while their model limits come from the same current catalog.
- Manual/custom reasoning metadata reaches Pi unchanged. A focused test captures the real pinned
  Google Vertex adapter's serialized request for `gemini-3.8-flash`: `maxOutputTokens: 65536` and
  `thinkingConfig.thinkingLevel: MINIMAL` for Thinking `off`. Pi owns that provider-specific mapping;
  this does not promise that the provider supports zero reasoning tokens.
- `length` now produces `output_limit_reached`, marks the request/run failed, logs the original
  error, preserves usage and interrupted visible text, and avoids automatic follow-up consumption
  or request replay. Interrupted answers are excluded from subsequent conversation context.
  Truncated auxiliary summaries also fail instead of becoming authoritative compaction output.
- Settings broadcasts the returned credential-free snapshot directly to Agent and Notebook
  selectors. Old initial catalog responses cannot overwrite a newer event; skills initialization
  remains independent. New runs resolve changed metadata without model reselection. An active run
  and its continuations retain their immutable original configuration.
- Focused Electron-hosted verification covers **115 distinct passing tests across nine files**.
  Budget and worker execution coverage (11 + 29 tests) passed in the initial 3.8-second invocation
  (`1788388997432-448-81d99733`). That invocation's one failing Main assertion used the wrong test
  helper shape; its focused rerun passed in 1.4 seconds (`1788389039179-1525-fa464922`). Final Main
  runtime, message, review, compaction and auxiliary-request coverage passed 65 tests in 4.4 seconds
  (`1788389222170-3176-5ebad272`). Catalog and event delivery passed 10 tests in 2.2 seconds
  (`1788389337358-4120-c55ca254`). Earlier fixture-only type errors were corrected; final static
  checks passed. Passing coverage for unchanged files was reused rather than rerun.
- One `pnpm check:e2e` invocation performed Biome (0.4 s), Main types (4.7 s), Renderer types
  (5.2 s), native preparation (0.6 s), and the only production compile (11.3 s), then ran four
  scenarios. Existing Thinking memory, exhausted-request recovery, and grounded proposal/reopen
  scenarios passed. The new configuration fixture initially lacked the API key required by Pi's
  execution path, so it failed before reaching the local test endpoint. Evidence:
  `1788389433330-5125-f19a06ab`, 56.3 seconds including 34.1 seconds of E2E.
- Only the fixture credential setup changed after that build. A focused `pnpm test:e2e` rerun
  passed the new configuration scenario and existing provider settings/persistence scenario in
  9.8 seconds (`1788389521275-6005-37b0698b`). The new scenario edits the selected model through
  Settings, observes its new selector label immediately, and captures the next request changing
  from 16,384 to 65,536 output tokens. Persisted run limits change from 262,144 to 1,048,576 context
  tokens while the earlier run stays unchanged. A subsequent truncated response displays the
  output-limit diagnostic and persists `failed` / `output_limit_reached`, with one request only.
  Overall: **five distinct passing Electron scenarios**, six attempts, one fixture correction,
  zero automatic retries, flakes, or skipped scenarios.
- Evidence is under `.cache/verification/` using the IDs above. Runtime: macOS arm64, Electron
  43.4.1, embedded Node 24.18.1 / ABI 148, pnpm 11.17.0. Host Node 26.8.1 retains its pre-existing
  engine warning; no toolchain pin was changed. Tests use local provider fixtures, not a live
  paid Gemini request. Other platforms and packaging/release gates were outside this repair.
  Final `pnpm check` and `git diff --check` passed after documentation synchronization.

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

- Authorization: the user approved upgrading `@earendil-works/pi-agent-core` and
  `@earendil-works/pi-ai` to exact `0.84.4` pins, adapting confirmed interface changes, and removing
  the Pi-version conversation gate. Conversation usability follows WriteLLM's event schema and
  validated history; `pi_runtime_version` remains creation provenance only. No version allowlist,
  version range, database migration, or rewriting of historical migration evidence is introduced.
- The lockfile updates only the Pi dependency graph. The runtime constant and provider model
  revision use the new pin, with manifest consistency coverage. The existing host nvm installed
  Node 24.15.0 for task commands; pnpm remains 11.17.0. Shell PATH changes are task-local, the
  default nvm alias remains `lts/*`, and the ordinary host shell still resolves Node 26.8.1.
  Lockfile generation took 7.6 seconds and the explicit frozen install took 3 seconds. Native
  preparation verified Electron 43.4.1 / Node 24.18.1 / ABI 148, better-sqlite3 12.11.1, and
  sqlite-vec 0.1.9 on macOS arm64.
- `shouldStopAfterTurn` handles output truncation before queued messages can be consumed;
  `prepareNextTurnWithContext` handles only actual continuations. Pending content remains a live
  stream state; unsupported pending/deferred terminal responses become explicit errors with
  partial output preserved and no retry. Provider model construction disables Anthropic's new
  automatic fallback while retaining the selected model and its original catalog snapshot.
- The obsolete scoped model-store wrapper is removed. Catalog and credential stores accept
  cancellation signals; cancelled refreshes fail explicitly, late results do not replace the
  current catalog, and queued credential cancellation cannot release an active modification's
  lock. The virtual Skill filesystem explicitly denies the newly required rename operation.
  The existing low-level Agent, application tools, persistence contracts, and logging authority
  remain in place; no external telemetry exporter is configured.
- `pnpm test` ran all 1,336 tests in 22.1 seconds (Vitest 21.4 seconds): 1,330 passed, three
  failed, and three existing benchmark tests were skipped, with zero automatic retries or
  unhandled errors. The failures exposed a cancelled catalog refresh reported as success,
  premature credential-tail cleanup, and an old xAI cancellation-message assertion. The first
  two were fixed and the assertion now checks `AbortError`. The affected Provider and Provider
  IPC rerun passed all 59 tests in nine files in 2.8 seconds (Vitest 2.4 seconds). Together with
  unaffected full-run results, final-source coverage is **1,333 passing tests plus three benchmark
  skips**. This includes real database reopen with an older or arbitrary recorded Pi version,
  unchanged history/provenance, continued messages/settings, event-schema rejection, archived
  write rejection, truncation, steering/follow-ups, tool continuations, and Skill loading.
  Evidence: `.cache/verification/1788420554995-2069-b0351878/` and
  `.cache/verification/1788420615923-3060-8280691d/`. The full runner's deliberately failing
  subprocess fixtures also printed a sandbox `kill EPERM` diagnostic; those fixture tests passed
  and the three suite failures above were assertion failures, not native-module failures.
- One `pnpm check:package` invocation passed in **210.4 seconds**, including Biome and both
  typechecks (10.5 seconds), one build/native preparation (12.3 seconds), App assembly
  (32.2 seconds), inventory of 33,383 ASAR entries, all 12 packaged runtime smoke scenarios
  (39.8 seconds), and all **34 packaged E2E scenarios** (93.2 seconds). E2E had zero failures,
  retries, flakes, or skips. The 31 recovery fixtures and no-Team-ID macOS signature policy also
  passed; installers were made from that same tested App in 22.0 seconds. Evidence:
  `.cache/verification/1788420662138-3420-a9d88d2f/` and
  `dist/macos-arm64/package-evidence.json`.
- The upgraded working-tree artifacts replace the preceding local build under unchanged
  `0.2026.9.1` release metadata: `dist/macos-arm64/mac-arm64/WriteLLM.app`,
  `WriteLLM-0.2026.9.1-arm64.dmg`, and `WriteLLM-0.2026.9.1-arm64.zip`. Package evidence correctly
  records dirty-source provenance. The existing local tag remains on its original source.
  No commit, tag, push, release, Developer ID signing, notarization, or publication was performed.
  Other platforms and live paid-provider experiments were outside this maintenance's acceptance
  scope. Final documentation and diff checks passed after synchronization.

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

- Authorization: the user approved the dependency security and maintenance plan. The approved
  scope updated direct provider, Renderer, formatting, data, PDF, Mermaid, TypeBox, and test
  patch/minor lines, refreshed vulnerable transitive packages only within parent-declared ranges,
  and left the deferred Vite 8, Vitest 4, TypeScript 7, Electron 44, better-sqlite3 13, Kysely
  0.29, KaTeX 0.18, thinking-orbs 0.3, and GitHub Action major migrations unchanged.
- Direct updates include `@ai-sdk/cohere` 4.0.37, `@ai-sdk/openai-compatible` 3.0.43,
  `@google/genai` 2.20.0, `@shadcn/react` 0.3.1, `@tanstack/react-query` 5.102.8,
  `ai` 7.0.90, `fast-xml-parser` 5.11.1, `isomorphic-git` 1.41.9, `lucide-react` 1.39.0,
  `mermaid` 11.17.2, `openai` 7.9.0, `pdfjs-dist` 6.3.289, `prosemirror-view` 1.42.3,
  `typebox` 1.3.25, `zod` 4.5.4, Biome 2.5.11, `@types/react-dom` 19.2.5, and `mammoth`
  1.12.2. The Biome schema URL was synchronized with the upgraded CLI.
- The workspace security overrides now resolve the complete Tiptap family to 3.31.2,
  `browserslist` to 4.28.8, `@xmldom/xmldom` to 0.8.15, and `fast-uri` to 3.1.7. The frozen
  install passed and the native preparation/load check retained Electron 43.4.1 / ABI 148,
  better-sqlite3 12.11.1, and sqlite-vec 0.1.9 on macOS arm64.
- The Gemini request-header test now validates the SDK version format instead of pinning the
  previous 2.18.0 string, so an approved SDK patch/minor update does not create a false failure.
  The affected publication tests passed 6 files / 22 tests; the TypeBox-dependent Agent tests
  passed 4 files / 56 tests.
- `pnpm audit --json` reports zero advisories across 1,193 resolved dependencies. Final
  `pnpm check:fast` passed all three stages. `pnpm check:electron` passed all six stages in
  43.6 seconds, including 237 test files / 1,333 passing tests / three existing benchmark skips,
  native preparation/load validation, and production compilation. The canonical Electron runner
  emitted the known non-fatal macOS `task_name_for_pid` diagnostic; the host Node 26.8.1 versus
  repository Node 24 engine warning remains an environment limitation. `git diff --check` passed.
- No database migration, product API, release, commit, tag, push, signing, notarization,
  promotion, or publication action was performed.
