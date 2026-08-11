# WriteLLM Implementation Tracker

Status: Checkpoint 27.6 is locally complete; local candidate v0.2026.8.11 is authorized; Checkpoint 26.9 is paused and all GitHub Actions workflows are disabled.
Recorded: 2026-08-11

This is the short, ordered tracker for active work. Update it when a task starts, becomes blocked,
or completes. Detailed checkpoint plans and verification evidence live in the linked Phase files;
do not copy them back into this index.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked

## Current checkpoint

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
