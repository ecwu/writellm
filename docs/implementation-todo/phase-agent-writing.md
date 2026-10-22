# Agent Writing Experience: Checkpoints 27–28

Status: complete through Checkpoint 28.6 and the recorded 28.x maintenance
Recorded: 2026-08-12

This file preserves the detailed plans, authorization, and verification evidence that previously
lived in the compact tracker. It is the authoritative Phase record for Checkpoints 27–28; delivery
state remains in [`../current-plan.md`](../current-plan.md), and cross-phase chronology remains in
[`../history/implementation-log.md`](../history/implementation-log.md).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-checkpoint-28x-audit-remediation-and-verification-hardening).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-286-configurable-citation-presentation-and-references).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-285-rolling-context-checkpoints-and-safe-recovery).

### Maintenance: Follow active Agent section edits

- [x] Follow the currently visible Agent conversation into the target section when a live
  `submit_section_change` or `generate_image` call starts, while preserving current manual edits,
  Agent-panel focus, background-conversation isolation, and the existing Renderer authority.
- [x] Add focused parser and Real-Electron coverage, then run the applicable Renderer, Electron,
  E2E, Impeccable, and diff verification gates.

Authorization: on 2026-08-12 the user approved the decision-complete plan and explicitly requested
implementation. This maintenance is Renderer-only and adds no IPC, persistence, Agent protocol,
mutation authority, package, release, hosted CI, commit, push, or promotion work.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-follow-active-agent-section-edits).

### Checkpoint 28.4: Multi-Conversation Agent Concurrency

- [x] Allow at most three request-scoped Agent runs in different conversations while preserving
  one active run per conversation, targeted cancellation, and the fixed single agent-worker role.
- [x] Add a project-scoped, capability-bound activity snapshot and live subscription so background
  conversation status and bounded partial output remain visible while switching conversations.
- [x] Keep the existing revision-checked proposal boundary authoritative under concurrent runs and
  harden the Agent composer for capacity, failure, and draft-preservation states in the desktop
  composer.
- [x] Add focused Main, Worker, IPC, Renderer, conflict, and Real-Electron coverage; run the full
  local Electron, E2E, package, Impeccable, recovery, and diff verification gates.

Authorization: on 2026-08-12 the user approved the decision-complete concurrency plan and
explicitly requested implementation. The accepted scope adds no database migration, durable job,
worker type, extra worker process, configurable limit, queue, release, hosted CI, commit, push, or
promotion.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-284-multi-conversation-agent-concurrency).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-283-agent-prompt-architecture).

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

- [x] Keep context, approval policy, model, Thinking, and Writing Skill as compact quick controls
  in the default composer while preserving the existing snapshot lock and Details diagnostics.
- [x] Replace generic `Working` with the current human-readable activity plus elapsed time, expose
  individual human-readable tool steps in the expandable activity row, and show completed duration.
- [x] Require concise user-visible intent and finding updates between material tool phases without
  exposing hidden reasoning or adding a new event/persistence contract.
- [x] Add focused policy, view-model, Renderer, keyboard, desktop, and Real-Electron coverage;
  run the applicable local verification and Impeccable gates.

Authorization: on 2026-08-12 the user explicitly requested this redesign using the supplied Codex
screenshots as the reference and later authorized a local unsigned macOS App build from the current
CP28.2 worktree. ADR 016 is accepted. Commit, tag, push, hosted CI, signed release, and promotion
remain unauthorized.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-282-agent-progress-visibility).

### Maintenance: v0.2026.8.12 local tag and macOS App

- [x] Set the release identifier to `0.2026.8.12`, verify the complete current worktree, create one
  local release-candidate commit and annotated `v0.2026.8.12` tag, then build and verify the
  unsigned macOS arm64 App with the no-identity unpacked package gate.

Authorization: on 2026-08-12 the user explicitly requested the `v0.2026.8.12` tag and App build.
This authorizes the necessary local commit and tag plus an unsigned macOS arm64 App. Push, hosted
CI, signing/notarization, GitHub Release, and promotion remain out of scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-v02026812-local-tag-and-macos-app).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-281-agent-flow-polish).

### Checkpoint 27.9: Adaptive section titles

- [x] Replace the editable section heading's single-line input with an unlimited soft-wrapping
  shadcn textarea, preserve logical single-line title metadata, move focus into the body after an
  Enter-triggered save, and keep sidebar and outline navigation compact. Add focused desktop
  Real-Electron coverage plus the applicable local verification gates.

Authorization: on 2026-08-11 the user approved the decision-complete adaptive-title plan and
explicitly requested implementation. This checkpoint is Renderer-only; manuscript persistence,
IPC, export, Agent behavior, packaging, release, hosted CI, commit, push, and promotion remain out
of scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-279-adaptive-section-titles).

### Maintenance: Whole-manuscript preview hardening

- [x] Keep the whole-manuscript preview inside the viewport, omit section objectives from the
  assembled reading surface, and resolve project images through the existing session-bound asset
  capability without widening Renderer authority.

Authorization: on 2026-08-11 the user reported viewport overflow, section objectives appearing as
manuscript content, and broken project images in the whole-manuscript preview, then approved the
decision-complete local Renderer repair plan. Package, release, hosted CI, commit, push, and
promotion remain out of scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-whole-manuscript-preview-hardening).

### Maintenance: Agent partial tool-failure summary

- [x] Distinguish a partially failed Agent activity group from a wholly failed group, show the
  failed-operation count without obscuring successful work, and add focused Renderer coverage.

Authorization: on 2026-08-11 the user reported that one failed operation makes the aggregate Agent
activity summary look wholly failed and explicitly requested a display improvement. This is a
Renderer-only presentation repair; it does not change Agent tools, execution, persistence, or
authority. Hosted CI, package, release, commit, push, and promotion remain out of scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-agent-partial-tool-failure-summary).

### Maintenance: Post-repair macOS arm64 package rebuild

- [x] Rebuild the current workspace as an unpacked macOS arm64 App plus DMG/ZIP, run the complete
  no-identity package gate, and verify runtime evidence, DMG layout, signature state, sizes, and
  checksums.

Authorization: on 2026-08-11 the user explicitly requested a fresh App and DMG after the MinerU
capability-invariant false-positive repair. This authorizes only the local unsigned macOS arm64
package; commit, push, hosted CI, signing/notarization, release, and promotion remain out of scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-post-repair-macos-arm64-package-rebuild).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-mineru-capability-invariant-false-positive-repair).

### Maintenance: Branded drag-to-Applications DMG

- [x] Replace the default Electron artwork with a generated WriteLLM icon, explicitly fix the
  macOS DMG app/Applications layout, build the local arm64 artifacts, and verify the mounted DMG,
  packaged icon, runtime gates, checksums, and intentionally unsigned distribution status.

Authorization: on 2026-08-11 the user requested a friend-distributable macOS DMG with a
drag-to-Applications Finder window and a new application icon. Hosted CI, workflow restoration,
commit, push, signing/notarization credential enrollment, and production promotion remain out of
scope.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-branded-drag-to-applications-dmg).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-278-agent-conversation-titles-and-archive-lifecycle).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#maintenance-distill-the-agent-run-summary).

### Checkpoint 27.7: Editor citation highlighting and source preview

- [x] Recognize the canonical English and Chinese readable citation labels in the section editor,
  highlight them without changing BlockNote JSON, and resolve clicks only through accepted Agent
  proposal provenance before opening the existing source preview. Add bounded Main-owned
  resolution, typed IPC, keyboard and error states, focused coverage, Real-Electron evidence, and
  the applicable local verification gates. Manuscript schema, citation policy, whole-manuscript
  preview, hosted CI, packaging, release, commit, push, and promotion remain out of scope.

Authorization: on 2026-08-11 the user approved the decision-complete Checkpoint 27.7 plan and
explicitly requested implementation.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-277-editor-citation-highlighting-and-source-preview).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-276-pi-native-progressive-writing-skills).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-275-agent-thinking-level).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-273-agent-academic-writing-and-citation-policy).

### Checkpoint 27.2: Agent approval experience repair

- [x] Keep the complete approval proposal and all actions visible inside the right Agent panel.
- [x] Reconcile the session header and historical review marker with the latest proposal decision.
- [x] Replace the raw approval-result JSON user message with concise, human-facing continuation copy
  while retaining Main-process approval authority.
- [x] Pass focused Main/Renderer coverage, `check:fast`, the applicable Electron gate, the Impeccable
  detector, and `git diff --check`.

Authorization: on 2026-08-10 the user explicitly requested these three approval-experience repairs.
No provider, protocol, release, hosted CI, package, push, or promotion work is authorized.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-272-agent-approval-experience-repair).

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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-271-agent-provider-request-lifetime-and-retry-policy).

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
- [!] Hosted Ubuntu pull-request critical and four-target tagged evidence was transferred to the
  paused Checkpoint 26.9 delivery gate and does not prevent local Checkpoint 27 completion.

Authorization: on 2026-08-09 the user explicitly approved starting this checkpoint before 26.9.
Checkpoint 26.9 is now paused and is not represented as complete.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-agent-writing.md#checkpoint-27-electron-e2e-evolution).
