# WriteLLM Current Plan

Status: Checkpoint 27.6 is locally complete; local candidate v0.2026.8.11 is authorized; Checkpoint 26.9 is paused and all GitHub Actions workflows are disabled.
Recorded: 2026-08-11

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current checkpoint

Checkpoint 27.6 is locally complete. It replaces the out-of-band Writing Skill model pre-router with
Pi-native progressive disclosure inside the formal Agent turn. Auto mode exposes a bounded,
virtual-URI catalog and adds one read-only `read_writing_skill` tool; explicit selection becomes a
durable session setting and injects the frozen primary Skill on every turn. WriteLLM retains
manifest, commit-pin, hash, dependency, prompt-budget, and no-private-path authority. Protocol v4
has thirteen bounded tools; it does not migrate the runtime to `AgentHarness`, add executable
skills, or expose general filesystem reads. The checkpoint also unifies single-shot and session
model transport construction so non-Skill requests honor the selected provider API and credential
envelope. The user explicitly approved implementation on 2026-08-10 and authorized the local
`v0.2026.8.11` commit, tag, and macOS arm64 package build on 2026-08-11. Push, hosted CI,
release, workflow restoration, and promotion remain out of scope.

Local evidence includes the focused native-loader, progressive Auto/Explicit runtime, tool
protocol, provider transport, migration, Main/Worker, IPC, and Renderer suites; `check:fast`;
`check:electron` with 129 passing Electron-hosted test files, 661 passing tests, and one opt-in
benchmark skipped; a successful production build; 22/22 full Real-Electron E2E scenarios without
flaky or skipped results; a focused Writing Skills scenario that proves two-turn explicit
persistence plus Auto `read_writing_skill` loading in the formal Agent turn; a clean Impeccable
detector; and `git diff --check`. No package, release, hosted CI, commit, push, or promotion was
run.

Checkpoint 27.5 is locally complete. It implements accepted ADR 014 as a conversation-scoped Pi
Thinking level with exact built-in-model capability projection, an application-global remembered
default, immutable run provenance, and provider-neutral worker propagation. Existing sessions and
runs remain `off`; custom providers and manual models remain `off`; chain-of-thought display,
reasoning summaries, persisted reasoning, Pro mode, and auxiliary-model controls remain deferred.
Local evidence includes focused contract/catalog/settings/migration/Main/Worker/Renderer tests;
`check:fast`; `check:electron` with 125 passing Electron-hosted test files, 644 passing tests, and
one opt-in benchmark skipped; a successful production build; all 22 full Real-Electron E2E
scenarios without flaky or skipped results; the focused `agent.thinking-level-memory` scenario;
23 verified recovery cases from 21 sources; a clean Impeccable detector; and `git diff --check`.
Hosted CI, package, release, commit, push, and promotion remain out of scope.

Checkpoint 27.4 is locally complete. It implements accepted ADR 013 as a bounded,
application-global Writing Skill manager: reviewed curated pins plus user-confirmed GitHub TOFU
installs, Main-owned text-only downloads and integrity checks, additive run provenance, cancellable
auto/explicit/none routing, Pi-compatible invocation blocks with deterministic prompt budgets,
Settings management, and an Agent composer skill picker. It does not add a thirteenth Agent tool,
executable plugins, model filesystem access, arbitrary URLs, automatic updates, or a Pi harness
migration. Completion requires focused tests, `check:fast`, `check:electron`, relevant real-
Electron E2E, the Impeccable detector, and `git diff --check`; hosted CI, package, release, commit,
push, and promotion remain out of scope.

The implementation is locally complete through Main storage/download/update authority, additive
app/project migrations, Pi-compatible prompt routing and retry provenance, Settings/composer UI,
and a network-free Real-Electron fixture scenario. Local evidence currently includes 63 focused
tests, `check:fast`, `check:electron` with 122 passing Electron-hosted test files, 626 passing tests
and one opt-in benchmark skipped, a successful production build, a clean Impeccable detector, and
`git diff --check`. The focused Real-Electron `agent.global-writing-skill` scenario also passes and
verifies that the global fixture remains visible across projects, explicit selection injects the
Pi-compatible skill block through a virtual URI, and the run persists its skill provenance. The
production Main bundle includes Pi's ESM-only root export so the same path starts successfully in
Electron. Acceptance review then fixed six findings — routing-completion composer refresh on the
first stream delta, the split General/Writing Skills settings entries, reference-counted skill
change subscriptions, an explicit GitHub Check update flow, companion-note omission on skill-free
runs, and update preserving a disabled skill's enabled state — and re-passed `check:fast`,
focused tests, `check:electron`, and the focused E2E scenario.

The user subsequently authorized one local macOS arm64 package for hands-on evaluation. The
unsigned, unnotarized `check:package` gate passed the 12-scenario packaged smoke, all 15 packaged
Electron E2E scenarios, native inventory and artifact inspection, and produced local DMG and ZIP
artifacts for version 0.2026.8.10. Commit, push, hosted CI, release, and promotion remain out of
scope.

Checkpoint 27.3 is locally complete. It strengthens the global Agent writing policy with bounded
claim-evidence reasoning, terminology and paragraph discipline, direct non-defensive academic
prose, targeted revision, citation-slot planning, mandatory expanded evidence, proposal
provenance, and readable citation labels. Raw internal citation IDs, `[xx]`-style placeholders, and
bare numeric markers without a verified manuscript bibliography mapping are prohibited. The work
adapts general methods from the referenced Nature and CCFA skills without importing venue-specific
citation quotas or granting new authority. Main also rejects model-authored raw citation IDs and
opaque citation placeholders at the typed section-proposal boundary, and requires readable source
fallback labels to carry expanded proposal citation provenance. Local evidence is 18 focused
tests; `check:fast`; `check:electron` with 119 passing Electron-hosted test files, 615 passing
tests, and one opt-in benchmark skipped; a successful production build; and `git diff --check`.

Accepted ADR 013 supersedes Checkpoint 27.3's proposed-only record. Checkpoint 27.4 owns the skill
implementation; Checkpoint 27.3 remains complete as the global-policy baseline beneath every skill.

Checkpoint 27.2 is locally complete. It repairs the Agent approval experience without changing the
proposal protocol or authority boundary: the pending proposal is now the timeline scroll anchor,
right-rail approval actions remain single-column until a wider container is available, session and
historical review states reconcile after a decision, and approval continuation uses human-facing
copy without raw IDs or JSON. Local evidence is 15 focused Main/Renderer tests; `check:fast`;
`check:electron` with 117 passing Electron-hosted test files, 602 passing tests, and one opt-in
benchmark skipped; a successful production build; the focused real-Electron
`agent.grounded-proposal-workflow` E2E scenario; a clean Impeccable detector result; and
`git diff --check`. Hosted CI, packaging, release, push, and promotion remain out of scope.

Checkpoint 27.1 is locally complete. It removes the Agent provider's 60-second
wall-clock deadline, retains request-scoped user/project cancellation, and adds at most five
provider-neutral logical attempts for transient failures before assistant content is published.
It does not change tool deadlines or embedding, reranking, MinerU, image, scheduler, close, or test
timeouts. ADR 012 defines the accepted behavior and compatibility boundary. Local evidence is
`check:fast`; 65 focused tests; 117 Electron-hosted Vitest files with 600 passing tests and one
opt-in benchmark skipped; a successful production build; and 20/20 full Electron E2E scenarios
with no flaky or skipped results, including transient Agent failure recovery and durable retry
metadata. Work remains local only; hosted CI, packaging, release, push, and promotion were not run.

Checkpoint 27 is locally complete. On 2026-08-09 the user explicitly authorized starting
Checkpoint 26.9, including the required commit, push, tag, hosted workflow dispatch, and protected
dry-run promotion. Checkpoint 26.9 is now paused before completion; its acceptance gate requires:

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

No hosted CI, release-candidate dry run, production promotion, or other GitHub Actions execution is
authorized. On 2026-08-10 the user stopped the remaining `v0.2026.8.10` macOS x64 package job after
the account exhausted its included Actions minutes, then directed that every workflow be disabled
for every trigger. The repository preserves the definitions only as `.yml.disabled` files, and the
two remote workflows are manually disabled. Restoring any workflow requires new explicit user
approval. Checkpoint 27.6 has that approval; do not start a subsequent product checkpoint without
new explicit user approval.

The current release-candidate identifier is `0.2026.8.11` (`v0.2026.8.11` as the Git tag). Its
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

The `.10` tag CI run `31390617065` passed the static gate, both macOS Electron rows, and the macOS
arm64 package row. The user manually cancelled the macOS x64 package row during artifact
construction to stop further billed usage. No `.10` dry-run or production promotion was started.
Checkpoint 26.9 therefore remains incomplete and paused.

## Deferred

- Clone/Save As with a new `projectId`, multiple manuscripts, external-edit synchronization, and
  project-wide file watching.
- Snap distribution and any auto-updater or update-feed subsystem.
- Chain-of-thought display, reasoning summaries, persisted reasoning, Provider Pro modes,
  custom/manual-model reasoning controls, additional Agent tools or tables, multi-agent workflows,
  long-term memory, and multi-level summaries.
- Alternative vector backends, client-side MinerU page-count enforcement, and model cost
  estimation.
- Mandatory paid-provider calls in CI; live certification remains separately authorized and does
  not replace deterministic loopback coverage.
