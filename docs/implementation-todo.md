# WriteLLM Implementation Tracker

Status: Checkpoint 26.9 hosted release-candidate validation is in progress.
Recorded: 2026-08-10

This is the short, ordered tracker for active work. Update it when a task starts, becomes blocked,
or completes. Detailed checkpoint plans and verification evidence live in the linked Phase files;
do not copy them back into this index.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked

## Current checkpoint

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
- [~] Install or launch every produced macOS artifact on its supported host and verify checksums,
  provenance, retention metadata, and signing or intentionally unsigned status.
- [~] Perform one protected macOS-only dry-run promotion without publishing a production release.
- [~] Record the exact revision, commands, runner images, test counts, artifact names, hashes, and
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
or additional candidate tag is authorized.

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
