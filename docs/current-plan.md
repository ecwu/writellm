# WriteLLM Current Plan

Status: Checkpoint 26.9 hosted release-candidate validation is in progress.
Recorded: 2026-08-10

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current checkpoint

Checkpoint 27 is locally complete. On 2026-08-09 the user explicitly authorized starting
Checkpoint 26.9, including the required commit, push, tag, hosted workflow dispatch, and protected
dry-run promotion. Checkpoint 26.9 is now in progress; its acceptance gate requires:

- a committed and tagged GitHub revision;
- successful macOS arm64 and macOS x64 hosted-runner rows from that revision;
- installation or launch verification for every produced macOS artifact;
- verified checksums, provenance, retention metadata, and required signing status; and
- one protected macOS-only dry-run promotion that does not publish a production release.

The promotion must remain a dry run and must not publish a production release. Windows and Linux
distribution are deferred; their current failures or incomplete rows do not block the macOS target
set and their artifacts must not enter its manifest. Local macOS arm64 results remain supporting
evidence, not a substitute for both hosted macOS rows. The authoritative scope, acceptance
criteria, and local evidence are in
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

Execute Checkpoint 26.9 from one clean tagged revision: verify both macOS hosted rows, rebuild and
verify only their four artifacts and governance evidence, perform the protected macOS-only dry-run
promotion without publishing a production release, and record the exact completion evidence.
Windows/Linux release rows are deferred. Do not start a later product checkpoint without explicit
user approval.

The current release-candidate identifier is `0.2026.8.10` (`v0.2026.8.10` as the Git tag). Its
package SemVer base is `0.2026.8`; the platform-native build-number mapping is defined in
[`release-policy.md`](release-policy.md#release-version). The immutable `v0.2026.8.1` candidate
failed its first hosted matrix on Windows file-URL path conversion and a non-deterministic macOS
provider-catalog E2E precondition, while Linux exposed concurrent Electron runner contention; it
remains audit evidence and is not moved or promoted.

The immutable `v0.2026.8.2` candidate passed both macOS rows. Windows exposed unsupported
directory fsync behavior, while Linux completed 12 of 20 serial E2E scenarios before eight
credential-dependent scenarios failed because headless Electron selected `basic_text` despite the
temporary Secret Service. It also remains failed audit evidence and is not moved or promoted.

The immutable `v0.2026.8.3` candidate again passed both macOS rows. Windows exposed CRLF-sensitive
provider-logo evidence, replace-existing rename behavior during concurrent asset publication, a
legacy `MAX_PATH` overflow in nested snapshot staging, and one test-owned database handle that
survived cleanup. Linux again completed 12 of 20 scenarios because the documented password-store
switch appeared after Electron's development application path and was therefore not applied. The
candidate remains failed audit evidence and is neither moved nor promoted.

The immutable `v0.2026.8.4` candidate passed the static gate and macOS arm64 row. macOS x64 passed
590 of 591 tests before one I/O-heavy database test exceeded the default five-second Vitest limit.
Windows passed its Electron tests/build and 13 of 20 E2E scenarios; the remaining long scenarios
exceeded the 45-second Playwright limit. Linux proved the password-store switch was now parsed,
but `--unlock` did not provision a login keyring in the fresh runner, so eight credential-dependent
scenarios still failed and several long scenarios also reached 45 seconds. The immutable
`v0.2026.8.5` candidate passed the static gate and both macOS rows. Windows passed
17 of 20 E2E scenarios; two longest scenarios reached the 90-second total limit near completion,
while the outline-conflict scenario automatically reached `Saved` before Playwright could click its
transient Retry button. Linux again passed 12 of 20 scenarios because its runner lacked a usable
`XDG_RUNTIME_DIR`, so the login collection did not exist and the Secret Service attempted an
unavailable graphical prompt. The immutable `v0.2026.8.6` candidate passed the static gate and both
macOS rows. Windows then exposed three known I/O-heavy canonical tests that exceeded Vitest's
default five-second limit. Linux passed the Secret Service probe and canonical tests, but Electron
still selected `basic_text` because D-Bus activation retained the runner's old runtime-directory
environment; 13 of 20 E2E scenarios passed. The immutable `v0.2026.8.7` candidate passed the static
gate, Windows, and both macOS rows. Linux passed the Secret Service API probe and canonical tests,
but the real application still selected `basic_text`; 13 of 20 E2E scenarios passed and packaging
was skipped. No dry-run was dispatched. Low-cost hosted preflight run `31380991013` then proved the
actual Electron 43 `safeStorage` backend with a successful `gnome_libsecret` encrypted round trip;
the expensive matrix remained skipped. Candidate `.8` carries that proven wrapper and gates every
hosted matrix on the same preflight. Candidates `.4` through `.7` remain failed audit evidence and
are neither moved nor promoted.

Candidate `.8` CI run `31381711382` passed macOS arm64 in 3m14s and macOS x64 in 6m32s from
revision `7312f01e0230a0fe8e4fd4c8ec34887a366d4b9a`. Windows and Linux later failed their complete
E2E steps, so the dependent package matrix was skipped. Those deferred failures do not satisfy or
block the narrowed macOS promotion scope, and no `.8` dry-run was dispatched.

Immutable candidate `.9` at `39c9b40b48f9b3367c8d82f118607bc89210a03b` consumed the one
authorized macOS-only attempt. CI run `31385773729` passed the static gate and both macOS Electron
test/build/E2E rows; its package rows then completed packaged smoke, all 15 packaged E2E scenarios,
and DMG/ZIP construction before electron-builder 26.15.3 implicitly enabled GitHub publishing and
failed because no `GH_TOKEN` was supplied. Protected dry-run `31387596825` reproduced the same
fail-closed result on both macOS rows. Linux was skipped, no Windows row was generated, promotion
was skipped, the run uploaded no candidate artifact, and no GitHub Release exists. The local fix
passes `--publish=never` to every electron-builder invocation and passed a simulated tag-CI package
gate without a token. On 2026-08-10 the user explicitly authorized exactly one immutable `.10`
macOS arm64/x64 tag CI and, only if it succeeds, exactly one macOS-only dry-run. Windows/Linux,
reruns, and production remain unauthorized.

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
