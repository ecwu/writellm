# WriteLLM Implementation Tracker

Status: Checkpoint 28.1 Agent Flow Polish is locally complete; local candidate v0.2026.8.11 remains authorized; Checkpoint 26.9 is paused and all GitHub Actions workflows are disabled.
Recorded: 2026-08-12

This is the short, ordered tracker for active work. Update it when a task starts, becomes blocked,
or completes. Detailed checkpoint plans and verification evidence live in the linked Phase files;
do not copy them back into this index.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked

## Current checkpoint

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
requested implementation. ADR 015 is accepted. No hosted CI, packaging, release, commit, push, or
promotion is authorized.

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

### Checkpoint 26.9: macOS release-candidate gate

- [x] Pass macOS arm64 and macOS x64 Electron tests/build/E2E from one committed and tagged clean
  revision; defer Windows/Linux distribution evidence.
- [!] Install or launch every produced macOS artifact on its supported host and verify checksums,
  provenance, retention metadata, and signing or intentionally unsigned status.
- [!] Perform one protected macOS-only dry-run promotion without publishing a production release.
- [!] Record the exact revision, commands, runner images, test counts, artifact names, hashes, and
  promotion outcome in the Phase 10 completion evidence.

Authorization: on 2026-08-09 the user explicitly approved starting Checkpoint 26.9, including the
required commit, push, tag, hosted workflow dispatch, and protected dry-run promotion. Production
release publication remains out of scope. On 2026-08-10 the active distribution scope was narrowed
to macOS arm64 and macOS x64; Windows/Linux release rows are deferred rather than silently accepted
as partial evidence.

Budget guard: after immutable candidate `v0.2026.8.7` proved three hosted Electron rows but failed
Linux credential persistence, no additional tag or rerun is allowed without a real Electron Linux
credential preflight. The preflight must fail before the expensive four-platform matrix starts.
Hosted run `31380991013` satisfied that guard on `main` in 2m26s; all matrix/package jobs remained
skipped. Candidate `v0.2026.8.8` then proved both macOS Electron rows, while its Windows/Linux E2E
rows failed and the dependent package matrix was skipped. Exactly one follow-up candidate,
`v0.2026.8.9`, is authorized for the explicit macOS-only matrix and dry-run; no Windows/Linux row
or additional candidate tag is authorized. That authorization has now been consumed. Tag CI run
`31385773729` and protected dry-run `31387596825` both completed the macOS application tests and
packaged E2E paths, then failed closed after electron-builder 26.15.3 implicitly enabled GitHub
publishing and found no `GH_TOKEN`. No candidate artifact was uploaded and no GitHub Release was
created. The local remediation explicitly passes `--publish=never` and has passed a tag-CI
simulation without a token; completing the hosted gate now requires explicit authorization for
one new immutable candidate and one dry-run. On 2026-08-10 the user granted that approval for
exactly one `v0.2026.8.10` macOS arm64/x64 tag CI and, only after it succeeds, exactly one
macOS-only dry-run. Windows/Linux, reruns, and production remain out of scope.

Pause record: tag CI run `31390617065` passed static, both macOS Electron rows, and the arm64
package row. The user manually stopped the x64 package row after included Actions minutes were
exhausted. No `.10` dry-run or production run started. On 2026-08-10 the user then directed that
all CI be stopped under every condition. Both remote workflows are manually disabled and their
repository definitions are preserved only as `.yml.disabled` files. No hosted work may resume
without new explicit approval.

Acceptance criteria: both macOS rows succeed for the same tagged revision; all migration,
recovery, export, native runtime, Agent, security, and logging boundaries pass in their packaged
artifacts; artifact governance is verified; and the protected dry-run rejects missing macOS rows,
extra deferred rows, mismatched provenance, or improperly signed evidence.

Authoritative detail:
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).

## Documentation maintenance

- [x] 2026-08-06: Reduce `current-plan.md` to the active checkpoint, completed baseline, next
  authorized work, and deferred scope; reduce this tracker to active work and document routing;
  correct stale Checkpoint 24 status in the architecture entry points. No architecture decision,
  product boundary, or checkpoint scope changed.

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
| Earlier phases | Matching file under [`implementation-todo/`](implementation-todo/) |
| Cross-phase maintenance | [`implementation-todo/maintenance.md`](implementation-todo/maintenance.md) |
| Completed chronology | [`history/implementation-log.md`](history/implementation-log.md) |
| Historical audits | [`audits/`](audits/) |

Do not start a later checkpoint until the current checkpoint passes its acceptance criteria and
the user explicitly approves continuation. Every implemented feature must retain the repository's
structured lifecycle logging, original-error preservation, security, and verification rules from
[`AGENTS.md`](../AGENTS.md).
