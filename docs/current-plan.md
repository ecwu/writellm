# WriteLLM Current Plan

Status: Checkpoint 26.9 hosted release-candidate validation is in progress.
Recorded: 2026-08-09

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current checkpoint

Checkpoint 27 is locally complete. On 2026-08-09 the user explicitly authorized starting
Checkpoint 26.9, including the required commit, push, tag, hosted workflow dispatch, and protected
dry-run promotion. Checkpoint 26.9 is now in progress; its acceptance gate requires:

- a committed and tagged GitHub revision;
- successful Windows x64, macOS arm64, macOS x64, and Linux x64 hosted-runner rows;
- installation or launch verification for every produced artifact;
- verified checksums, provenance, retention metadata, and required signing status; and
- one protected dry-run promotion that does not publish a production release.

The promotion must remain a dry run and must not publish a production release. Local macOS arm64
results are supporting evidence, not a substitute for the four hosted rows. The authoritative
scope, acceptance criteria, and local evidence are in
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).

Checkpoint 27 evolves the Electron Playwright suite around independent user outcomes. It
decomposes multi-purpose flows and replaces count-only packaged evidence with isolated fixtures,
stable scenario identities, critical/package tiers, two-worker execution, strict renderer-error
diagnostics, axe-core accessibility checks, and a single-platform pull request smoke gate. It
retains real Electron, Main/Preload/Renderer, SQLite, filesystem, and controlled loopback
boundaries; it does not add a test-only privileged IPC surface.

## Completed baseline

- Checkpoint 24: Main-authoritative, deterministic whole-manuscript native and Markdown export,
  verified referenced assets, explicit Markdown loss reporting, atomic collision-safe
  publication, and path-bounded IPC.
- Checkpoint 25: four native-host package targets, fail-closed Electron ABI and architecture
  preparation, target-specific sqlite-vec resources, executable package inventory, deterministic
  artifact evidence, and source-independent packaged smoke coverage.
- Checkpoints 26.1–26.8: pinned least-privilege CI and promotion workflows, versioned recovery
  fixtures, packaged security and logging coverage, artifact governance, and fail-closed release
  verification.
- Checkpoint 26.8S: all eleven findings from the 2026-07-31 security scan were remediated and
  verified. [`ADR 011`](adrs/011-security-boundary-remediation.md) defines the accepted controls
  and residual risks.
- Maintenance through 2026-08-04: the cross-platform matrices run only for tag refs; pull requests
  and `main` retain the static and fixture gates; the scheduled trigger was removed.

The latest complete local Checkpoint 27 gate passed exact pnpm 11.17.0 `check:fast`, 115
Electron-hosted Vitest files with 583 passing tests and one opt-in benchmark skipped, all 20
fresh-build Electron E2E scenarios with two workers and no flaky or skipped results, all 6 critical
scenarios, the no-identity macOS arm64 package gate, 12 packaged smoke scenarios, and all 15
manifest-selected packaged E2E scenarios. Recovery evidence covers 22 cases from 20 sources. This
local evidence completes the implementation portion of Checkpoint 27 but does not complete 26.9.

## Current authorized work

Execute Checkpoint 26.9 from one clean tagged revision: run the complete four-target hosted matrix,
verify every artifact and its governance evidence, perform the protected dry-run promotion without
publishing a production release, and record the exact completion evidence. Do not start a later
product checkpoint without explicit user approval.

The current release-candidate identifier is `0.2026.8.2` (`v0.2026.8.2` as the Git tag). Its
package SemVer base is `0.2026.8`; the platform-native build-number mapping is defined in
[`release-policy.md`](release-policy.md#release-version). The immutable `v0.2026.8.1` candidate
failed its first hosted matrix on Windows file-URL path conversion and a non-deterministic macOS
provider-catalog E2E precondition, while Linux exposed concurrent Electron runner contention; it
remains audit evidence and is not moved or promoted.

## Deferred

- Clone/Save As with a new `projectId`, multiple manuscripts, external-edit synchronization, and
  project-wide file watching.
- Snap distribution and any auto-updater or update-feed subsystem.
- Provider reasoning controls, chain-of-thought display, additional Agent tools or tables,
  multi-agent workflows, long-term memory, and multi-level summaries.
- Alternative vector backends, client-side MinerU page-count enforcement, and model cost
  estimation.
- Mandatory paid-provider calls in CI; live certification remains separately authorized and does
  not replace deterministic loopback coverage.
