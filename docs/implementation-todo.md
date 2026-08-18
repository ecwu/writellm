# WriteLLM Implementation Tracker

Status: Phase 12 Checkpoint 56 is implemented and verified. Checkpoints 52-55 and Phase 11 remain
complete and verified. Checkpoint 26.9 remains paused and all GitHub Actions workflows are
disabled.
Recorded: 2026-08-18

This is the short, ordered tracker for active work. Update it when a task starts, becomes blocked,
or completes. Detailed checkpoint plans and verification evidence live in the linked Phase files;
do not copy them back into this index.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked

## Local v0.2026.8.17 tag and macOS App (2026-08-18)

- [x] Advance release metadata to `0.2026.8.17`, create the clean local release commit and
  annotated `v0.2026.8.17` tag, then build and verify the no-identity macOS arm64 App from that
  tagged revision. Push, hosted CI, signing/notarization, GitHub Release creation, and promotion
  remain out of scope.

Local evidence: `check:fast` and `git diff --check` passed; the recovery manifest was refreshed for
three changed source hashes and one renamed fail-closed Agent test, then all 25 cases from 23
sources passed. The no-identity macOS arm64 unpacked package gate passed the production build,
native/ASAR/resource and no-Team-ID signature checks, 12/12 packaged runtime smoke scenarios, and
28/28 packaged Real-Electron scenarios. The final App is rebuilt from the clean annotated tag.

## Application icon redesign and Dock contrast (2026-08-13)

- [x] Replace the dark textured application icon with a bright folded-paper WriteLLM mark, derive
  the macOS, Windows, packaging, and Linux runtime assets from one master, and verify the packaged
  macOS icon plus the routine package gate without performing release work.
- [x] Preserve the folded-paper geometry while deepening the blue background so the warm-white W
  remains legible at macOS Dock sizes; regenerate the platform assets and rebuild the macOS App.

## Local build environment and Windows/Linux packaging (2026-08-13)

- [x] Install the pinned Linux/WSL development environment and document headless Electron usage.
- [x] Add local Windows NSIS, Windows AppX, and Linux x64 package commands with deterministic
  target directories and native-host checks.
- [x] Verify the environment, static checks, Linux build, and target build plans without resuming
  hosted CI or release promotion. `pnpm run check:fast`, Electron ABI/native inventory, Linux
  AppImage/deb creation, and all three target plans passed. The packaged E2E suite passed 24/26
  scenarios with the two remaining failures limited to existing Agent section selection and slow
  workspace behavior; no installer or native-module failure was observed.
- [x] Fix the recovery-fixture containment check for Windows path separators so the Windows package
  gate can validate the same manifest as Linux.
- [x] Fix Windows package-gate execution of `npm.cmd` by launching the command through the Windows
  shell required for `.cmd` wrappers.
- [x] Fix Windows ASAR inventory reads by converting normalized `/` archive paths to the platform
  separator required by `@electron/asar`.
- [x] Run Windows packaged E2E serially with a 180-second scenario budget and retry transient
  Windows `EBUSY` fixture cleanup after Electron closes.
- [x] Normalize CRLF to LF before recovery-fixture source and manifest hashing so Windows checkouts
  retain the same integrity evidence as Linux and macOS.
- [x] Remove the remaining Windows packaged-E2E races by selecting the newly created Agent section
  explicitly, waiting for project close before deleting template files, and allowing the corrupt
  index rebuild its bounded 60-second recovery window; make the responsive scroll fixture create
  its own overflow, close persisted windows before unregistering IPC during app shutdown, and
  refresh the recovery manifest for the intentionally changed index-recovery fixture.
- [x] Close a partially initialized Index-worker SQLite handle before reporting startup failure so
  Windows can delete and rebuild a corrupt derived index without an `EBUSY` retry loop.

## Current checkpoint

### Phase 12: Use And Fix

- [~] Checkpoint 48: simplify the Agent composer with truthful approval policy, a combined concise
  model/effort selector, and one shared Add/leading-slash catalog for existing context and Writing
  Skill actions while preserving the accepted Agent authority boundary.
- [x] Build and verify one local no-identity macOS arm64 unpacked App from the current Checkpoint
  48 worktree for hands-on use; do not create DMG/ZIP artifacts or perform release work.
- [x] Apply the ADR 039 hands-on fix: use icon-free `Manual`, `Section`, and `YOLO` approval
  shorthand and prevent the approval/model/Send controls from overlapping in narrow panels.
- [x] Apply the ADR 040 hands-on refinement: make idle Send a primary circular upward-arrow button
  while preserving accessibility and the distinct running-state controls.
- [x] Rebuild one no-identity macOS arm64 unpacked App with the final CP48 refinements and create
  the explicitly authorized local Phase 12 commit without pushing or releasing it.
- [x] Checkpoint 49: replace the permanent running Queue/Steer controls with a bounded,
  Main-authoritative multi-message waiting list above the composer, per-item Steer/Delete, and one
  Stop-or-Send terminal action while preserving provider and persistence ordering.
- [x] Checkpoint 50: audit and harden all 20 model-visible Agent tool contracts with Pi-style
  one-way schema compatibility, tool-aware recovery, compact descriptions, approval-continuation
  scope discipline, and safe failure presentation under accepted ADR 042.
- [x] Checkpoint 51: preserve the current Pi assistant/tool-result batch across provider-context
  pruning, project only completed older read batches, and allow one structured smaller-read
  recovery before a truthful terminal context-capacity failure under ADR 046.
- [x] Checkpoint 52: add a read-only Checks workspace and bounded Main-owned article-level
  Knowledge citation coverage over the active current index generation under ADR 047.
- [x] Checkpoint 53: allow Main to copy one exact existing image into another section without
  generation, then permit exact source removal only after the destination insertion applies under
  ADR 048.
- [x] Checkpoint 54: replace lossy conversation pre-projection with a writing-specific bounded
  handoff plus an adaptive recent raw-turn tail, and fail before provider work rather than silently
  omitting uncheckpointed user requirements under ADR 049.
- [x] Checkpoint 55: surface the latest trustworthy run-matched context-window usage as a neutral,
  accessible circular indicator beside the Agent model/Thinking trigger under ADR 050.
- [x] Checkpoint 56: replace the permanently expanded Agent writing-task header with a centered
  bottom Step capsule and a keyboard-accessible plan/change-set Popover while preserving existing
  task and proposal authority.

Authoritative detail: [`implementation-todo/phase-12.md`](implementation-todo/phase-12.md).

### Checkpoint 26.9: macOS release-candidate gate (paused)

- [x] Pass macOS arm64 and macOS x64 Electron tests/build/E2E from one committed and tagged clean
  revision; defer Windows/Linux distribution evidence.
- [!] Install or launch every produced macOS artifact on its supported host and verify checksums,
  provenance, retention metadata, and signing or intentionally unsigned status.
- [!] Perform one protected macOS-only dry-run promotion without publishing a production release.
- [!] Record the exact revision, commands, runner images, test counts, artifact names, hashes, and
  promotion outcome in the Phase 10 completion evidence.

Pause record: tag CI run `31390617065` passed static, both macOS Electron rows, and the arm64
package row. The user manually stopped the x64 package row after included Actions minutes were
exhausted. No `.10` dry-run or production run started. On 2026-08-10 the user then directed that
all CI be stopped under every condition; both remote workflows are manually disabled and their
definitions are preserved only as `.yml.disabled` files. No hosted work may resume without new
explicit approval.

Authoritative detail:
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).

### Phase 11 (Checkpoints 29–47B): complete

Phase 11 is complete under ADRs 021–037. Per-checkpoint checklists, plans, and verification
evidence live in [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md); do not copy
them back into this index.

## Completed: Agent writing experience (CP27-28)

### Maintenance: Checkpoint 28.x Audit Remediation And Verification Hardening

- [x] Remove the compaction path's duplicate semantic wrapper and escape pass while preserving the
  typed safe projection and exact coverage metadata.
- [x] Add an application-owned semantic boundary around mandatory Writing Skill entrypoints and
  close the narrow active-run/manual-compaction slot-release windows.
- [x] Add the missing focused Main reference-index, whole-export loss, and section-export coverage;
  then run the approved Electron, E2E, recovery, Impeccable, and diff gates.

Authorization: on 2026-08-12 the user approved the decision-complete Checkpoint 28.x audit
remediation plan and explicitly requested implementation. This maintenance does not reopen
Checkpoint 28.6 or authorize new IPC, migrations, Renderer authority, package/release, hosted CI,
commit, tag, push, or publication work.

Local evidence: 7 focused Electron-hosted files / 82 passing tests; `check:fast` passed;
`check:electron` passed with 142 Electron-hosted test files, 773 passing tests, one opt-in benchmark
skipped, and a successful production build; the fresh full Real-Electron gate passed 25/25
scenarios without flakes or skips; all 25 recovery fixtures from 23 sources passed; the single-pass
Impeccable detector over the current uncommitted Renderer implementation files was clean; and
`git diff --check` passed. This is a four-test maintenance increment above the unchanged Checkpoint
28.6 baseline of 142 files / 769 passing tests. Package/release, hosted CI, commit, tag, push, and
publication were not run.

### Checkpoint 28.6: Configurable Citation Presentation And References

- [x] Keep canonical readable citation labels in BlockNote revisions while adding application-level
  full, numbered, and icon presentation modes plus a manuscript-wide References rail surface.
- [x] Make citation-free word and character counts authoritative through count algorithm v2 and a
  forward-only project migration that preserves pruned historical revision rows.
- [x] Route section and whole-manuscript Markdown through one Main/shared numbered-citation export
  boundary without changing LLM prompts, proposal provenance, or manuscript identity.
- [x] Add focused shared/Main/IPC/Renderer/migration/export coverage and run the applicable local
  Electron, E2E, recovery, Impeccable, and diff verification gates.

Authorization: on 2026-08-12 the user supplied and explicitly requested implementation of the
decision-complete Checkpoint 28.6 plan. The work is additive to the completed Checkpoint 28.5
worktree and does not authorize package/release, hosted CI, commit, push, or publication work.

Local evidence: 71 focused citation, count, contract, repository, IPC, migration, export, and
Renderer tests passed; `check:fast` passed; `check:electron` passed with 142 Electron-hosted test
files, 769 passing tests, one opt-in benchmark skipped, and a successful production build; the
fresh full Real-Electron gate passed 25/25 scenarios without flakes or skips; all 25 recovery
fixtures from 23 sources passed; the scoped Impeccable detector was clean; and `git diff --check`
passed. Package/release, hosted CI, commit, push, and publication were not run.

### Checkpoint 28.5: Rolling Context Checkpoints And Safe Recovery

- [x] Accept ADR 019, amend ADR 018, and align the architecture/current-plan baseline around three
  project-level Agent work slots, rolling conversation checkpoints, and deterministic recovery.
- [x] Add Agent event schema v3 and migration 0027 while preserving raw Agent events and project
  business rows as the only authority and retaining legacy checkpoint readability.
- [x] Plan the final model-visible context after model, Writing Skill, system prompt, tool schema,
  and current-request resolution; build continuous rolling checkpoints plus a bounded recent tail.
- [x] Add typed compaction projections, exact model-request correlation, failure fallback, and
  context-overflow retry only before any assistant/tool/proposal side effect.
- [x] Add capability-bound manual compact/stop IPC, project activity, conversation-menu controls,
  timeline markers, restart recovery, and focused Main/Worker/Renderer/security coverage.
- [x] Run the approved focused gates, `check:fast`, `check:electron`, fresh E2E, recovery fixtures,
  package verification, the scoped Impeccable detector, and `git diff --check`.

Authorization: on 2026-08-12 the user supplied the decision-complete Checkpoint 28.5 plan and
explicitly requested implementation. The checkpoint adds no compaction or long-term-memory table,
durable job, worker, auxiliary model, cross-session memory, editable prompt/token setting, release,
hosted CI, commit, push, or publication work.

Local evidence: the focused contract, migration, planner, session, Worker, provider, IPC, broker,
Renderer, prompt, and safety suites passed; `check:fast` passed; `check:electron` passed with 140
files and 758 tests, one opt-in benchmark skipped, plus the production build; the fresh full
Real-Electron suite passed 24/24 without flakes or skips; all 24 recovery fixtures from 22 sources
passed; the scoped Impeccable detector returned no findings; and `git diff --check` was clean. The
required no-identity macOS arm64 package gate passed all 12 packaged runtime smoke scenarios and
16/16 packaged Real-Electron scenarios, verified the Agent Worker/native inventory, the unpacked
App, DMG, ZIP, and no Apple Team identity. No signed release, hosted CI, commit, tag, push, or
publication was performed.

### Maintenance: Follow active Agent section edits

- [x] Follow the currently visible Agent conversation into the target section when a live
  `submit_section_change` or `generate_image` call starts, while preserving current manual edits,
  Agent-panel focus, background-conversation isolation, and the existing Renderer authority.
- [x] Add focused parser and Real-Electron coverage, then run the applicable Renderer, Electron,
  E2E, Impeccable, and diff verification gates.

Authorization: on 2026-08-12 the user approved the decision-complete plan and explicitly requested
implementation. This maintenance is Renderer-only and adds no IPC, persistence, Agent protocol,
mutation authority, package, release, hosted CI, commit, push, or promotion work.

Local evidence: the focused Agent panel suite passed 5/5; two focused Real-Electron Agent scenarios
passed without flakes or skips, covering save-before-follow, focus preservation, scroll reset,
narrow-window behavior, background-conversation isolation, and historical replay; `check:fast`
passed; and `check:electron` passed on its confirming run with 137 files and 733 tests, one opt-in
benchmark skipped, plus the production build. The first full Electron run exposed one unrelated
scheduler timing timeout; its focused retry and the complete confirming run both passed. The scoped
Impeccable detector returned no findings, and `git diff --check` was clean. No package, release,
hosted CI, commit, push, or promotion was performed.

### Checkpoint 28.4: Multi-Conversation Agent Concurrency

- [x] Allow at most three request-scoped Agent runs in different conversations while preserving
  one active run per conversation, targeted cancellation, and the fixed single agent-worker role.
- [x] Add a project-scoped, capability-bound activity snapshot and live subscription so background
  conversation status and bounded partial output remain visible while switching conversations.
- [x] Keep the existing revision-checked proposal boundary authoritative under concurrent runs and
  harden the Agent composer for capacity, failure, narrow-window, and draft-preservation states.
- [x] Add focused Main, Worker, IPC, Renderer, conflict, and Real-Electron coverage; run the full
  local Electron, E2E, package, Impeccable, recovery, and diff verification gates.

Authorization: on 2026-08-12 the user approved the decision-complete concurrency plan and
explicitly requested implementation. The accepted scope adds no database migration, durable job,
worker type, extra worker process, configurable limit, queue, release, hosted CI, commit, push, or
promotion.

Local evidence: `check:fast` passed; `check:electron` passed with 137 files and 731 tests, with one
opt-in benchmark skipped, plus the production build; the full Real-Electron suite passed 24/24
without flakes or skips; all 23 recovery fixtures and the scoped Impeccable detector passed; and
`git diff --check` was clean. The required no-identity macOS arm64 package gate passed 12/12 runtime
smoke scenarios and 16/16 packaged Real-Electron scenarios, including the concurrency scenario,
and verified the unpacked App, DMG, ZIP, native inventory, and no Apple Team identity. No signed
release, hosted CI, commit, tag, push, or promotion was performed.

### Checkpoint 28.3: Agent Prompt Architecture

- [x] Inventory application-owned Agent prompts and compare their responsibilities with the
  current OpenAI Codex base, mode/task-template, compaction, and runtime-context layering.
- [x] Consolidate base policy, system composition, Writing Skill companion guidance, and bounded
  task templates under one Main-owned prompt module without provider-specific copies.
- [x] Give every dynamic prompt payload an explicit semantic boundary that content cannot close,
  and freeze prompt precedence plus size-budget behavior with focused tests.
- [x] Refine concise progress, autonomy, response, and checkpoint-handoff instructions; run the
  applicable local verification gates and record exact evidence.

Authorization: on 2026-08-12 the user asked to audit WriteLLM's prompts against OpenAI Codex and
improve the project's currently scattered prompt management. ADR 017 is accepted for this bounded
internal checkpoint. No tool, authority, provider-specific prompt fork, persistence, migration,
background job, packaging, release, hosted CI, commit, push, or promotion is authorized.

Local evidence: 68 focused prompt, context, session, Skill-budget, and IPC tests; `check:fast`;
`check:electron` with 137 passing files, 723 passing tests, one opt-in benchmark skipped, and a
successful production build; and `git diff --check`. The focused coverage proves fixed layer order,
prompt-budget review, title and compaction handoffs, review-continuation integration, and that
dynamic project, Skill-reference, conversation, and review content cannot close its declared
semantic block.

### Maintenance: Reviewed Writing Skill catalog expansion

- [x] Review the user-supplied CCFA and Nature repositories against WriteLLM's text-only,
  no-shell, no-network Writing Skill authority; add only compatible, commit- and blob-pinned
  catalog entries; and verify the focused catalog/service boundary plus the applicable local
  gates.

Evidence: added `ccf-visual-composer`, `ccf-paper-reviewer`, `ccf-integrity-auditor`, and
`nature-statistics` with reviewed commit pins, UTF-8 text allowlists, byte sizes, and Git blob
SHAs. Focused catalog/service/prompt-budget coverage passed (3 files, 10 tests), `check:fast`
passed, `check:electron` passed (137 files and 723 tests, with 1 benchmark skipped, plus the
production build), and the focused Real-Electron `agent.global-writing-skill` scenario passed.
No package, release, hosted CI, commit, push, or promotion was performed as part of this task.

Authorization: on 2026-08-12 the user explicitly asked to supplement WriteLLM's existing Writing
Skill registry from `mikubaka88/CCFA-Skills` and `Yuan1z0825/nature-skills`. This maintenance does
not authorize new tools, executable Skill content, arbitrary file/network access, packaging,
release, hosted CI, commit, push, or promotion.

### Checkpoint 28.2: Agent Progress Visibility

- [x] Keep context, approval policy, model, Thinking, and Writing Skill as responsive quick controls
  in the default composer while preserving the existing snapshot lock and Details diagnostics.
- [x] Replace generic `Working` with the current human-readable activity plus elapsed time, expose
  individual human-readable tool steps in the expandable activity row, and show completed duration.
- [x] Require concise user-visible intent and finding updates between material tool phases without
  exposing hidden reasoning or adding a new event/persistence contract.
- [x] Add focused policy, view-model, Renderer, keyboard, narrow-layout, and Real-Electron coverage;
  run the applicable local verification and Impeccable gates.

Authorization: on 2026-08-12 the user explicitly requested this redesign using the supplied Codex
screenshots as the reference and later authorized a local unsigned macOS App build from the current
CP28.2 worktree. ADR 016 is accepted. Commit, tag, push, hosted CI, signed release, and promotion
remain unauthorized.

Local evidence: 26 focused policy, view-model, and Renderer tests; `check:fast`;
`check:electron` with 135 passing files, 716 passing tests, one opt-in benchmark skipped, and a
successful production build; fresh `check:e2e` with 23/23 Real-Electron scenarios and no failures,
flakes, or skips; 23/23 recovery fixtures; a clean scoped Impeccable detector; and
`git diff --check`. The grounded Agent scenario verifies the five visible quick controls, concise
assistant progress between material tool phases, expandable human-readable tool steps, and the
unchanged review boundary. The global Writing Skill scenario verifies isolated composer/Details
popover state and immutable Skill snapshots. The authorized no-identity macOS arm64 package gate
passed 12/12 packaged runtime smoke scenarios and 15/15 packaged Real-Electron scenarios, verified
app.sqlite integrity and no Apple Team identity, and produced an unpacked App, DMG, ZIP, and package
evidence from source revision `daff1fc` plus the documented dirty CP28.2 worktree.

### Maintenance: v0.2026.8.12 local tag and macOS App

- [x] Set the release identifier to `0.2026.8.12`, verify the complete current worktree, create one
  local release-candidate commit and annotated `v0.2026.8.12` tag, then build and verify the
  unsigned macOS arm64 App with the no-identity unpacked package gate.

Authorization: on 2026-08-12 the user explicitly requested the `v0.2026.8.12` tag and App build.
This authorizes the necessary local commit and tag plus an unsigned macOS arm64 App. Push, hosted
CI, signing/notarization, GitHub Release, and promotion remain out of scope.

Local evidence: `check:fast`; recovery fixture verification with all 23 cases; `git diff --check`;
the no-identity macOS arm64 unpacked package gate with 12/12 packaged runtime smoke scenarios and
15/15 packaged Real-Electron scenarios; bundle version `0.2026.8` / build `2026.8.12`; and a
verified no-Team-ID ad-hoc/linker signature. The final App is rebuilt from the clean annotated tag.

### Checkpoint 28.1: Agent Flow Polish

- [x] Replace the session-list-first Agent sidebar with a continuous conversation canvas that
  resumes the running, review-requiring, or most recent active conversation and lazily creates a
  new session only on first use.
- [x] Distill the header, context scope, composer, activity timeline, runtime details, keyboard
  behavior, and cross-session active-run state into one progressively disclosed writing flow.
- [x] Add focused proposal review with Apply and continue as the primary action, bounded feedback
  revision as a new immutable run, safe partial-failure recovery, and unchanged typed mutation and
  revision authority.
- [x] Add focused contracts, Main/IPC, Renderer, accessibility, and Real-Electron coverage, then
  pass the applicable local verification gates.

Authorization: on 2026-08-12 the user approved the decision-complete CP28.1 plan and explicitly
requested implementation. ADR 015 is accepted. The later `v0.2026.8.12` request authorizes the
local candidate commit, tag, and unsigned macOS arm64 App build; push, hosted CI, signed release,
and promotion remain unauthorized.

Local evidence: 90 focused tests; `check:fast`; `check:electron` with 135 passing files, 715 passing
tests, one opt-in benchmark skipped, and a successful production build; fresh `check:e2e` with
23/23 Real-Electron scenarios and no failures, flakes, or skips; a clean scoped Impeccable
detector; and `git diff --check`. The grounded Agent scenario proves feedback-only presentation,
Main-owned revision continuation, per-run citation re-authorization, revised proposal review,
Apply and continue, exactly one accepted manuscript mutation, reopen, Undo, title regeneration,
archive, and restore. Package, release, hosted CI, commit, push, and promotion were not run.

### Checkpoint 27.9: Adaptive section titles

- [x] Replace the editable section heading's single-line input with an unlimited soft-wrapping
  shadcn textarea, preserve logical single-line title metadata, move focus into the body after an
  Enter-triggered save, and keep sidebar and outline navigation compact. Add focused desktop and
  narrow-window Real-Electron coverage plus the applicable local verification gates.

Authorization: on 2026-08-11 the user approved the decision-complete adaptive-title plan and
explicitly requested implementation. This checkpoint is Renderer-only; manuscript persistence,
IPC, export, Agent behavior, packaging, release, hosted CI, commit, push, and promotion remain out
of scope.

Local evidence: the focused `manuscript.section-title-wraps` Real-Electron scenario at desktop and
narrow widths; `check:fast`; `check:electron` with 134 passing Electron-hosted test files, 704
passing tests, one opt-in benchmark skipped, and a successful production build; a clean scoped
Impeccable detector; and scoped `git diff --check`.

### Maintenance: Whole-manuscript preview hardening

- [x] Keep the whole-manuscript preview inside the viewport, omit section objectives from the
  assembled reading surface, and resolve project images through the existing session-bound asset
  capability without widening Renderer authority.

Authorization: on 2026-08-11 the user reported viewport overflow, section objectives appearing as
manuscript content, and broken project images in the whole-manuscript preview, then approved the
decision-complete local Renderer repair plan. Package, release, hosted CI, commit, push, and
promotion remain out of scope.

Local evidence: 4/4 focused project-asset URL tests; `check:fast`; `check:electron` with 134 passing
Electron-hosted test files, 704 passing tests, one opt-in benchmark skipped, and a successful
production build; the focused narrow-window workspace and rich-media preview Real-Electron
scenarios; a clean scoped Impeccable detector; and scoped `git diff --check`.

### Maintenance: Agent partial tool-failure summary

- [x] Distinguish a partially failed Agent activity group from a wholly failed group, show the
  failed-operation count without obscuring successful work, and add focused Renderer coverage.

Authorization: on 2026-08-11 the user reported that one failed operation makes the aggregate Agent
activity summary look wholly failed and explicitly requested a display improvement. This is a
Renderer-only presentation repair; it does not change Agent tools, execution, persistence, or
authority. Hosted CI, package, release, commit, push, and promotion remain out of scope.

Local evidence: 15/15 focused Agent view-model tests; `check:fast` with the full Biome check plus
Node and Renderer typechecks; a clean scoped Impeccable detector; and scoped `git diff --check`.

### Maintenance: Post-repair macOS arm64 package rebuild

- [x] Rebuild the current workspace as an unpacked macOS arm64 App plus DMG/ZIP, run the complete
  no-identity package gate, and verify runtime evidence, DMG layout, signature state, sizes, and
  checksums.

Authorization: on 2026-08-11 the user explicitly requested a fresh App and DMG after the MinerU
capability-invariant false-positive repair. This authorizes only the local unsigned macOS arm64
package; commit, push, hosted CI, signing/notarization, release, and promotion remain out of scope.

Local evidence: exact pnpm 11.17.0; Electron 43.1.0 ABI 148; arm64 `better-sqlite3` 12.11.1 and
`sqlite-vec` 0.1.9 inventory; a successful production build; 23 recovery fixture cases from 21
sources; all 12 packaged smoke scenarios; 15/15 packaged Real-Electron E2E scenarios with no
failures, flakes, or skips; an arm64 unpacked App with bundle version `2026.8.11`; and an immutable
read-only DMG mount containing `WriteLLM.app`, `Applications -> /Applications`, the configured
background, and the exact generated ICNS bytes. The App is intentionally ad-hoc/no-Team-ID and is
not notarized. `WriteLLM-0.2026.8.11-arm64.dmg` is 257,528,314 bytes with SHA-256
`94814c96a93cd58b9c6a70f06548d615c3501a7932b7fec9665757f0f43d12bf`; the companion ZIP is
254,341,328 bytes with SHA-256
`2b49454ff68a6b000c366477464e9f23977c34fa0503c0ba1eb808af810728db`.

### Maintenance: MinerU capability invariant false-positive repair

- [x] Keep persisted MinerU URL capabilities fail-closed while excluding manuscript and other
  user-authored content from the value scan; add focused regression coverage and verify that the
  affected project opens without rewriting its content.

Authorization: on 2026-08-11 the user reported that a forced quit left a project in the generic
recovery-required state and explicitly requested the repair. Runtime evidence showed an
integrity-valid database whose `sections.objective` contained the ordinary text
`recovery_capability`; the global text-column scan misclassified that manuscript text as a
persisted MinerU capability. No hosted CI, package, release, commit, push, or promotion work is
authorized.

Local evidence: exact pnpm 11.17.0; 2 focused Electron-hosted files with 21 passing tests;
`check:fast`; `check:electron` with 134 passing files, 704 passing tests, one opt-in benchmark
skipped, and a successful production build; scoped `git diff --check`; and an immutable read-only
inspection of the affected project showing `quick_check=ok`, no foreign-key errors, zero forbidden
schema or operational values, one permitted manuscript marker, and an unchanged database SHA-256
before and after inspection.

### Maintenance: Branded drag-to-Applications DMG

- [x] Replace the default Electron artwork with a generated WriteLLM icon, explicitly fix the
  macOS DMG app/Applications layout, build the local arm64 artifacts, and verify the mounted DMG,
  packaged icon, runtime gates, checksums, and intentionally unsigned distribution status.

Authorization: on 2026-08-11 the user requested a friend-distributable macOS DMG with a
drag-to-Applications Finder window and a new application icon. Hosted CI, workflow restoration,
commit, push, signing/notarization credential enrollment, and production promotion remain out of
scope.

Local evidence: exact pnpm 11.17.0; a successful production build; Electron ABI 148 with arm64
`better-sqlite3` and `sqlite-vec`; the 12-scenario packaged smoke; 15/15 packaged Real-Electron E2E
scenarios with no failures, flakes, or skips; a read-only mounted DMG containing `WriteLLM.app`, an
`Applications -> /Applications` link, the standard drag arrow background, and the exact generated
ICNS bytes; an intentionally ad-hoc/no-Team-ID application signature; and inspected DMG/ZIP
artifacts. `WriteLLM-0.2026.8.11-arm64.dmg` is 257,527,981 bytes with SHA-256
`db866481280a10c9148489c3583e0bf347956fcd7d1aac73b75f9a965c8dfc9f`; the companion ZIP is
254,339,825 bytes with SHA-256
`5a3af3a9874bd5aa59c4f426a9ecb4c741750c90f256d5791f8b2c206d69aa8b`.

### Checkpoint 27.8: Agent conversation titles and archive lifecycle

- [x] Generate an immediate bounded fallback title from the first prompt, run one non-blocking
  recorded title request through the selected conversation model, and support idle-only manual
  regeneration from bounded durable history.
- [x] Add status-filtered session listing plus idempotent idle-only archive/restore IPC while
  keeping archived history readable and every session mutation fail-closed.
- [x] Add Active/Archived Agent views, accessible row/header menus, local title progress, archived
  read-only behavior, focused coverage, Real-Electron evidence, and the applicable local gates.

Authorization: on 2026-08-11 the user approved the decision-complete plan, confirmed Checkpoint
27.7 acceptance, and explicitly requested Checkpoint 27.8 implementation. The user later authorized
a fresh local App build after reporting a packaged-runtime title failure. Release, hosted CI,
commit, push, and promotion work remain unauthorized.

Local evidence: 54 focused title, archive, contract, broker, and IPC tests; `check:fast`;
`check:electron` with 133 passing Electron-hosted test files, 697 passing tests, and one opt-in
benchmark skipped; a successful production build; 22/22 full Real-Electron E2E scenarios including
automatic/manual title flows, keyboard menus, archived read-only history, and restore; a clean
Impeccable detector; and `git diff --check`. A same-day runtime follow-up made title request
parameters reasoning-aware after Codex rejected the explicit temperature and DeepSeek exhausted the
non-reasoning output budget. Follow-up evidence includes 36/36 focused service/worker tests,
`check:fast`, the complete `check:electron` gate, the 23-case recovery-fixture verifier, and an
unsigned macOS arm64 unpacked package with 12/12 packaged smoke scenarios and 15/15 packaged E2E
scenarios. Release, hosted CI, commit, push, and promotion were not run.

### Maintenance: Distill the Agent run summary

- [x] Replace the active-run badge cluster with one primary status and a progressively disclosed
  run-details control; keep model, Thinking, Writing Skill provenance, and warnings accessible
  without giving every datum equal visual weight. Remove redundant ordinary-state badges and keep
  the visible usage summary limited to input/output tokens.

Authorization: on 2026-08-11 the user reported that the Agent sidebar run summary had become
visually confusing as model, Thinking, and Writing Skill metadata accumulated, and explicitly
requested the simplification. This is a Renderer-only presentation repair; Agent execution,
persistence, selection, and provenance remain unchanged. Hosted CI, package, release, commit,
push, and promotion remain out of scope.

Local evidence: `check:fast`; a successful production build; the focused
`agent.global-writing-skill` Real-Electron scenario with active-run assertions for zero ordinary
badges plus accessible provider/model/Thinking/Skill details; a clean scoped Impeccable detector;
visual inspection of the active run and open details popover; and scoped `git diff --check`.

### Checkpoint 27.7: Editor citation highlighting and source preview

- [x] Recognize the canonical English and Chinese readable citation labels in the section editor,
  highlight them without changing BlockNote JSON, and resolve clicks only through accepted Agent
  proposal provenance before opening the existing source preview. Add bounded Main-owned
  resolution, typed IPC, keyboard and error states, focused coverage, Real-Electron evidence, and
  the applicable local verification gates. Manuscript schema, citation policy, whole-manuscript
  preview, hosted CI, packaging, release, commit, push, and promotion remain out of scope.

Authorization: on 2026-08-11 the user approved the decision-complete Checkpoint 27.7 plan and
explicitly requested implementation.

Local evidence: frozen dependency installation; 23 focused parser, extension, resolver, IPC,
session-validation, and safe-logging tests; `check:fast`; `check:electron` with 132 passing
Electron-hosted test files, 686 passing tests, and one opt-in benchmark skipped; a successful fresh
production build; the focused grounded Agent Real-Electron scenario covering keyboard and mouse
preview activation, exact source content, focus restoration, reopen, and undo; a clean Impeccable
detector; and `git diff --check`. Package, release, hosted CI, commit, push, and promotion were not
run.

### Maintenance: Recent project path de-duplication

- [x] Keep only the newest recent-project pointer for each canonical project path, clean existing
  duplicate pointers during application database migration 0006, and prevent future duplicates
  with transactional replacement plus a database uniqueness constraint. Focused repository and
  migration coverage (2 files / 10 tests), `check:fast`, and `check:electron` (129 passing files /
  665 passing tests, one opt-in benchmark skipped, and a successful production build) pass.

### Checkpoint 27.6: Pi-native progressive Writing Skills

- [x] Amend ADR 013 and the architecture baseline for Agent Harness Protocol v4, the bounded
  `read_writing_skill` tool, Pi-native discovery/invocation formatting, and durable session
  selection.
- [x] Replace the extra SkillRouter model request with a manifest-backed virtual Pi loader,
  bounded Auto catalog, one-primary run lock, dependency entrypoints, and lazy references.
- [x] Add migration 0026, idle-only session selection IPC, immutable Retry/Continue snapshots,
  unavailable explicit-selection fail-closed behavior, and persistent Renderer selection.
- [x] Share provider-neutral model/transport construction between session and single-shot Agent
  requests; remove the hard-coded OpenAI Completions path.
- [x] Close K3 acceptance findings: expose historical SkillRouter usage in bounded run metadata,
  add cancellable Writing Skill operations, remove the unused legacy section-change channel,
  render durable approval decisions, and harden Renderer run-truth merging in the view-model.
- [x] Pass focused native-loader/Auto/Explicit/protocol/provider/migration/UI tests, `check:fast`,
  `check:electron`, production build, `check:e2e`, the Impeccable detector, and
  `git diff --check`.
- [x] Repair the production-discovered Protocol v4 validation regressions: permit
  `read_citations` requests-only pagination, keep ordinary invalid tool arguments recoverable,
  and align progressive curated Writing Skill metadata with its bounded resource contract.
  Focused regression coverage (4 files / 15 tests), `check:fast`, `check:electron` (129 files /
  663 tests plus one opt-in benchmark skipped), the production build, and `git diff --check` pass.
- [x] Stage Writing Skill preparation before downstream Agent tools: avoid redundant explicit
  entrypoint reads, select at most four task-relevant references, wait for their results, and do
  not mix Skill reads with non-Skill tools in one assistant response. Focused prompt/tool coverage
  (2 files / 9 tests), `check:fast`, `check:electron` (129 passing files / 666 passing tests and one
  opt-in benchmark skipped), the production build, and `git diff --check` pass.

Authorization: on 2026-08-10 the user explicitly approved and requested implementation of the
decision-complete Checkpoint 27.6 plan. On 2026-08-11 the user authorized the local
`v0.2026.8.11` commit, tag, and macOS arm64 package build. Push, hosted CI, release, workflow
restoration, and promotion remain unauthorized.

Local evidence: focused native-loader, progressive Auto/Explicit runtime, tool protocol,
provider transport, migration, Main/Worker, IPC, and Renderer suites; `check:fast`;
`check:electron` with 129 passing Electron-hosted test files, 661 passing tests, and one opt-in
benchmark skipped; a successful production build; 22/22 full Real-Electron E2E scenarios with no
flaky or skipped results; the focused `agent.global-writing-skill` scenario covering two-turn
explicit persistence and Auto `read_writing_skill`; a clean Impeccable detector; and
`git diff --check`.

### Checkpoint 27.5: Agent Thinking Level

- [x] Accept ADR 014 and establish the session/run snapshot, Pi-owned capability mapping,
  remembered-default, built-in-only, and no-thinking-display boundaries.
- [x] Add shared contracts, supported-level catalog projection, remembered app setting, and the
  additive project migration for session/run Thinking levels.
- [x] Propagate the validated runtime model descriptor and snapshotted level through Main,
  `model_requests`, and the agent-worker Pi loop.
- [x] Add the idle-only shadcn Thinking selector and immutable active-run status.
- [x] Pass focused tests, `check:fast`, `check:electron`, production build, relevant Real-Electron
  E2E, the Impeccable detector, and `git diff --check`.

Authorization: on 2026-08-10 the user approved the decision-complete Checkpoint 27.5 plan and
explicitly requested implementation. Hosted CI, package, release, commit, push, and promotion are
not authorized.

Local evidence: focused contract/catalog/settings/migration/Main/Worker/Renderer suites;
`check:fast`; `check:electron` with 125 passing Electron-hosted test files, 644 passing tests, and
one opt-in benchmark skipped; a successful production build; 22/22 full Real-Electron E2E
scenarios with no flaky or skipped results; the focused `agent.thinking-level-memory` scenario;
23 recovery cases from 21 sources; a clean Impeccable detector; and `git diff --check`.

### Checkpoint 27.4: Global Writing Skill management

- [x] Accept ADR 013 and establish the fixed budget, reviewed-pin, text-only, provenance, and
  auto/explicit/none invariants in the architecture documents.
- [x] Implement the application-global catalog, Main downloader, integrity-verified atomic
  storage, `app.sqlite` state, and bounded `desktop.skills` IPC.
- [x] Add project-local run provenance and route-request migrations without changing the existing
  `operation_kind` CHECK, then integrate cancellable routing and ordered Pi skill prompt assembly.
- [x] Add the Writing Skills Settings surface and the Agent composer `/` skill selector using the
  existing shadcn new-york components.
- [x] Focused tests, `check:fast`, `check:electron` (122 files / 626 tests), the production build,
  Impeccable detector, `git diff --check`, and the network-free focused Real-Electron
  `agent.global-writing-skill` scenario pass.
- [x] Acceptance review fixes: the composer refreshes on the first stream delta after routing,
  the generic Settings entry opens General while only the Agent entry opens Writing Skills,
  skill change subscriptions are reference-counted per webContents, GitHub skills have an
  explicit Check update flow before the unreviewed-update confirmation, skill-free runs omit the
  companion note, and updates preserve a disabled skill's enabled state.
- [x] State-propagation audit fixes: a tampered skill is demoted and published instead of
  rejecting `loadEnabled` (lazy paths in `loadById`/`readResource` demote and emit
  `skills:changed`), setup failures publish the queued prompt and mark the run snapshot
  `failed` instead of leaving it `pending`, a user stop during history compaction records
  `user_stopped` rather than `compaction_failed`, the composer leaves "Choosing writing
  skill…" on the guaranteed post-routing `user_message` (tool-first and non-streaming runs),
  terminal markers label every Main-emitted code from the shared view-model helper, a staged
  explicit chip is cleared when its skill leaves the valid set and is no longer consumed by
  Retry/Continue reuse, Settings surfaces Main error details and keeps a just-updated GitHub
  skill on "Latest pinned", and the dead `installedSkill.updateKind: 'unreviewed'` contract
  value is removed. The 0019 migration test now derives the backup suffix from
  `PROJECT_SCHEMA_VERSION` instead of a hardcoded version.

Authorization: on 2026-08-10 the user accepted ADR 013, reviewed the revised implementation plan,
and explicitly requested Checkpoint 27.4 implementation. No hosted CI, package, release, commit,
push, or promotion work is authorized.

Packaging addendum: the user subsequently authorized one local macOS arm64 package for hands-on
evaluation. `check:package` passed the 12 packaged-smoke scenarios, all 15 packaged Electron E2E
scenarios, native inventory, and DMG/ZIP structural inspection. Commit, push, hosted CI, release,
and promotion remain unauthorized.

### Checkpoint 27.3: Agent academic writing and citation policy

- [x] Replace the minimal global writing prompt with bounded claim-evidence, paragraph-cohesion,
  terminology, humanization, and targeted-revision rules adapted from the referenced Nature and
  CCFA writing methods.
- [x] Require citation-slot planning, expanded evidence, proposal citation provenance, and readable
  manuscript labels; prohibit raw citation IDs and unmapped `[xx]`/bare numeric markers.
- [x] Pass focused Main/Worker coverage, `check:fast`, the applicable Electron gate, and
  `git diff --check`.
- [x] Record the bounded downloadable-skill design in proposed ADR 013 without implementing it
  before explicit approval.

Authorization: on 2026-08-10 the user explicitly requested improving the writing/citation prompt
with the referenced Nature/CCFA methods and asked to consider bundled Pi Agent skills. The prompt
work is authorized. ADR 013 records the architecture change required for on-demand, user-installed
skills; its implementation is not yet approved. No new Agent tools, generic plugin/skill loading,
hosted CI, package, release, push, or promotion work is authorized.

Local evidence: 18 focused Main policy/context/proposal tests; `check:fast`; `check:electron` with
119 passing Electron-hosted test files, 615 passing tests, and one opt-in benchmark skipped; a
successful production build; and `git diff --check`.

### Checkpoint 27.2: Agent approval experience repair

- [x] Keep the complete approval proposal and all actions visible inside the right Agent panel.
- [x] Reconcile the session header and historical review marker with the latest proposal decision.
- [x] Replace the raw approval-result JSON user message with concise, human-facing continuation copy
  while retaining Main-process approval authority.
- [x] Pass focused Main/Renderer coverage, `check:fast`, the applicable Electron gate, the Impeccable
  detector, and `git diff --check`.

Authorization: on 2026-08-10 the user explicitly requested these three approval-experience repairs.
No provider, protocol, release, hosted CI, package, push, or promotion work is authorized.

Local evidence: 15 focused Main/Renderer tests; `check:fast`; `check:electron` with 117 passing
Electron-hosted test files, 602 passing tests, and one opt-in benchmark skipped; a successful
production build; the focused real-Electron `agent.grounded-proposal-workflow` E2E scenario; a
clean Impeccable detector result; and `git diff --check`.

### Checkpoint 27.1: Agent provider request lifetime and retry policy

- [x] Remove the Agent provider wall-clock deadline while preserving user-stop, project-close, and
  worker-lifecycle cancellation.
- [x] Add one provider-neutral policy with at most five logical attempts for transient failures
  before assistant output is published, including abortable backoff and bounded retry metadata.
- [x] Persist exhausted and permanent provider failures accurately while retaining historical
  `provider_timeout` replay compatibility.
- [x] Stop the Agent settings surface from overwriting the legacy ignored timeout field; retain
  credential-bound stored configuration without a migration.
- [x] Pass focused runtime/Main/Renderer coverage plus local static, Electron, E2E, and diff gates.

Authorization: on 2026-08-10 the user explicitly approved executing this checkpoint. Tool
deadlines and non-Agent provider timeouts remain out of scope. No hosted CI, package, release, push,
or promotion work is authorized.

Local evidence: `check:fast`; 65 focused tests; 117 Electron-hosted Vitest files with 600 passing
tests and one opt-in benchmark skipped; a successful production build; 20/20 full Electron E2E
scenarios with no flaky or skipped results; and `git diff --check`. The Agent E2E scenario now
forces a transient HTTP 503, recovers automatically, and verifies durable `retryCount: 1` evidence.

### Checkpoint 27: Electron E2E evolution

- [x] Replace page-shaped mega-flows with stable, independently executable user-outcome scenarios
  and thin isolated fixtures; retain real Electron/Main/Preload/SQLite/filesystem boundaries.
- [x] Add stable scenario IDs and critical/packaged tiers, two-worker execution, strict flaky/error
  diagnostics, and key accessibility/focus coverage without screenshot baselines.
- [x] Add an Ubuntu pull-request critical gate while retaining four-target complete tagged E2E.
- [x] Replace the packaged `18 passed` string check with versioned, fail-closed scenario evidence
  and update affected recovery evidence.
- [x] Pass local static, canonical Electron, critical/full/repeat E2E, package, recovery, and diff
  gates.
- [!] Obtain hosted Ubuntu pull-request critical and four-target tagged evidence when Git/GitHub
  execution is authorized.

Authorization: on 2026-08-09 the user explicitly approved starting this checkpoint before 26.9.
Checkpoint 26.9 remains in progress and is not represented as complete.

Local evidence: `check:fast`; 115 Electron-hosted Vitest files with 583 passing tests and one
opt-in benchmark skipped; 20/20 full Electron E2E scenarios with two workers and no flaky or
skipped results; 6/6 critical scenarios; 15/15 packaged E2E scenarios; 12 packaged smoke
scenarios; and 22 recovery cases from 20 sources.

## Completed baseline

- [x] Checkpoint 24: whole-manuscript export and portability.
- [x] Checkpoint 25: reproducible native packaging completion.
- [x] Checkpoints 26.1–26.8: cross-platform workflow, recovery, security, logging, artifact, and
  promotion implementation.
- [x] Checkpoint 26.8S: security-boundary remediation under
  [`ADR 011`](adrs/011-security-boundary-remediation.md).

## Plan and history routing

| Scope | Authoritative document |
| --- | --- |
| Current delivery state | [`current-plan.md`](current-plan.md) |
| Architecture and invariants | [`architecture.md`](architecture.md) |
| Long-lived decisions | [`adrs/`](adrs/) |
| Checkpoints 24–26 | [`implementation-todo/phase-10.md`](implementation-todo/phase-10.md) |
| Checkpoints 20–23 | [`implementation-todo/phase-9.md`](implementation-todo/phase-9.md) |
| Checkpoints 29–47 | [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md) |
| Earlier phases | Matching file under [`implementation-todo/`](implementation-todo/) |
| Completed chronology | [`history/implementation-log.md`](history/implementation-log.md) |
| Historical audits | [`audits/`](audits/) |

Do not start a later checkpoint until the current checkpoint passes its acceptance criteria and
the user explicitly approves continuation. Every implemented feature must retain the repository's
structured lifecycle logging, original-error preservation, security, and verification rules from
[`AGENTS.md`](../AGENTS.md).
