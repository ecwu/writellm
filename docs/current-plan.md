# WriteLLM Current Plan

Status: Local candidate v0.2026.8.13 tag and unsigned macOS arm64 App build are locally complete above the locally complete Checkpoint 28.x worktree; Checkpoint 26.9 is paused and all GitHub Actions workflows are disabled.
Recorded: 2026-08-12

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current checkpoint

The local `v0.2026.8.13` release-candidate maintenance is locally complete above the completed
Checkpoint 28.x worktree. It authorizes one local release-candidate commit, one annotated tag, and
the no-identity unsigned macOS arm64 package gate producing a verified App, DMG, and ZIP. Hosted
CI, Apple signing/notarization, push, GitHub Release, and promotion remain outside scope.

Local release evidence includes `check:fast`; the earlier complete Electron gate with 142 passing
files and 773 passing tests plus one opt-in benchmark skip; the fresh full Real-Electron gate with
25/25 scenarios; all 25 recovery fixtures from 23 sources; `git diff --check`; and the no-identity
macOS arm64 package gate with 12/12 packaged runtime smoke scenarios and 16/16 packaged
Real-Electron scenarios. The bundle version is `0.2026.8`, the macOS build version is `2026.8.13`,
and the App has a verified no-Team-ID ad-hoc/linker signature. The final App, DMG, ZIP, and package
evidence are rebuilt from the clean annotated tag. Hosted CI, Apple signing/notarization, push,
GitHub Release, and promotion were not run.

Checkpoint 28.x audit remediation and verification hardening is locally complete as a bounded
maintenance item above the completed Checkpoints 28.3-28.6. It removes one double-escaped
compaction boundary, gives mandatory Writing Skill entrypoints an application-owned semantic
wrapper, closes narrow Agent work-slot lifetime gaps, and adds the missing focused Main citation
index/export coverage. It changes no IPC contract, database schema, migration, Renderer authority,
or product feature. Its implementation did not authorize package/release, hosted CI, commit, tag,
push, or publication; the later `v0.2026.8.13` maintenance authorizes only the local candidate
commit, tag, and unsigned package described above.

Local evidence includes 7 focused Electron-hosted files with 82 passing tests; `check:fast`;
`check:electron` with 142 passing Electron-hosted test files, 773 passing tests, one opt-in
benchmark skipped, and a successful production build; a fresh full Real-Electron gate with 25/25
scenarios passing without flakes or skips; all 25 recovery fixtures from 23 sources; a clean
single-pass Impeccable detector over the current uncommitted Renderer implementation files; and
`git diff --check`. The maintenance added four tests above, and does not rewrite, the Checkpoint
28.6 baseline of 142 files and 769 passing tests. Package/release, hosted CI, commit, tag, push, and
publication were not run for the audit maintenance itself.

Checkpoint 28.6 keeps canonical readable citation labels in BlockNote revisions and all LLM/Agent
input while deriving three editing presentations: full text, manuscript-wide `[n]`, and a reference
icon. One shared NFC-plus-trim, case-sensitive parser and first-occurrence index drives editor
decorations and a new References rail destination. References keeps the editor mounted and reuses
the existing provenance-gated source resolver, including explicit ambiguous and unavailable states.

Count algorithm v2 excludes valid canonical citations from word and character totals without
joining surrounding text. Project migration 0028 widens the historical revision constraint,
recalculates retained bodies, preserves pruned v1 rows, and requires v2 for every current/new
revision. Section and whole-manuscript Markdown now share the Main converter and current manuscript
index, emit only global `[n]` markers with no mapping, and report the deliberate loss. ADR 020 fixes
these presentation, counting, migration, and export boundaries. App migration, LLM/prompt changes,
project reference registries, package/release, hosted CI, commit, push, and publication are outside
scope. Implementation and the approved local verification sequence are complete.

Local evidence includes 71 focused citation, count, contract, repository, IPC, migration, export,
and Renderer tests; `check:fast`; `check:electron` with 142 passing Electron-hosted test files, 769
passing tests, one opt-in benchmark skipped, and a successful production build; a fresh full
Real-Electron gate with 25/25 scenarios passing without flakes or skips; all 25 recovery fixtures
from 23 sources; a clean scoped Impeccable detector; and `git diff --check`. Package/release,
hosted CI, commit, push, and publication were not run.

Checkpoint 28.5 implements accepted ADR 019 and the ADR 018 slot amendment. Raw Agent events and
project business rows remain authoritative; model-visible history is rebuilt from the latest
successful rolling checkpoint, a continuous recent tail, and current authoritative context. Final
budget planning occurs after the conversation model, Writing Skill, system prompt, exact shared
tool schemas, and current request are resolved. Automatic and conversation-menu manual compaction,
typed safe projections, exact model-request correlation, deterministic failure fallback, bounded
overflow retry, restart closure, and event-schema migration 0027 are in scope.

The fixed project capacity is now three Agent work reservations rather than three runs. A manual
compaction occupies one reservation and has no fabricated run; an automatic compaction reuses its
run reservation. No compaction table, long-term or cross-conversation memory, new worker, auxiliary
model, editable compaction prompt/token control, release, hosted CI, commit, push, or publication is
authorized. Implementation and local verification are complete.

Local evidence includes the focused contract, migration, planner, session, Worker, provider, IPC,
broker, Renderer, prompt, and safety suites; `check:fast`; `check:electron` with 140 passing
Electron-hosted test files, 758 passing tests, one opt-in benchmark skipped, and a successful
production build; a fresh full Real-Electron gate with 24/24 scenarios passing without flakes or
skips; all 24 recovery fixtures from 22 sources; a clean scoped Impeccable detector; and
`git diff --check`. The required no-identity macOS arm64 package gate passed all 12 packaged runtime
smoke scenarios and 16/16 packaged Real-Electron scenarios, verified the Agent Worker and native
resource inventory, the unpacked App, DMG, ZIP, and the absence of an Apple Team identity. Signed
release, hosted CI, commit, tag, push, and publication were not run.

Agent section following is locally complete as a Renderer-only maintenance item above the completed
Checkpoint 28.4 baseline. When the currently visible conversation begins a live section mutation,
the manuscript editor saves and follows its target section without stealing focus from the Agent
panel. Background conversations and historical replay do not trigger following, while same-section
events preserve the current scroll and focus state. IPC, persistence, and mutation authority remain
unchanged.

Local evidence includes the five-test focused Agent panel suite; two focused Real-Electron Agent
scenarios covering save-before-follow, focus preservation, scroll reset, narrow-window behavior,
background-conversation isolation, and historical replay; `check:fast`; `check:electron` with 137
passing Electron-hosted test files, 733 passing tests, one opt-in benchmark skipped, and a successful
production build; a clean scoped Impeccable detector; and `git diff --check`. Package, release,
hosted CI, commit, push, and promotion were not run for this maintenance.

Checkpoint 28.4 is locally complete. It replaces the application-level single-Agent mutex with a fixed
three-slot project limit while preserving one run per conversation and the single agent-worker
process. Main reserves slots before asynchronous preparation, routes lifecycle operations by run,
and cancels all active work on project close. The worker hosts isolated request-scoped Pi loops,
and a new project-scoped activity snapshot plus live subscription keeps bounded streaming state
available across conversation switches.

ADR 018 fixes the concurrency, snapshot-ordering, cancellation, and shared-worker failure
boundaries. Renderer drafts and streaming output are conversation-local; reaching capacity blocks
only a new run, while switching and controls for existing runs remain available. Existing proposal
and manuscript CAS remains the sole mutation authority. No migration, durable job, worker type,
extra process, queue, configurable limit, release, hosted CI, commit, push, or promotion is in
scope.

Local evidence includes `check:fast`; `check:electron` with 137 passing Electron-hosted test files,
731 passing tests, one opt-in benchmark skipped, and a successful production build; a fresh full
Real-Electron gate with all 24 scenarios passing without flakes or skips; all 23 recovery fixtures;
a clean scoped Impeccable detector; and `git diff --check`. The no-identity macOS arm64 package gate
also passed all 12 packaged runtime smoke scenarios and 16/16 packaged Real-Electron scenarios,
including the new multi-conversation concurrency flow, then verified the unpacked App, DMG, ZIP,
native resources, and no Apple Team identity. Signed release, hosted CI, commit, tag, push, and
promotion were not run.

Checkpoint 28.3 is locally complete. It audits WriteLLM's application-owned Agent prompts against the
current OpenAI Codex prompt organization, then consolidates base policy, prompt composition,
Writing Skill companion guidance, and bounded task templates under one Main-owned prompt module.
Dynamic project, Skill-reference, conversation, and review content receive explicit non-escapable
semantic boundaries. The checkpoint may refine concise collaboration, autonomy, handoff, and final
response guidance, but it adds no tool, authority, provider-specific prompt fork, persistence,
migration, background job, or Renderer access.

The user requested the audit and improvement on 2026-08-12. ADR 017 records the prompt ownership,
precedence, composition, and verification contract. Local evidence includes 68 focused prompt,
context, session, Skill-budget, and IPC tests; `check:fast`; `check:electron` with 137 passing
Electron-hosted test files, 723 passing tests, one opt-in benchmark skipped, and a successful
production build; and `git diff --check`. Packaging, release, hosted CI, commit, push, and
promotion remain out of scope.

Checkpoint 28.2 is locally complete. It corrects the over-concealment introduced by CP28.1: the
Agent composer keeps context, approval policy, model, Thinking, and Writing Skill directly
available; the running status names the current activity; activity summaries expand into
individual human-readable steps; and the model provides concise progress messages between
materially different tool phases. Raw tool names, bounded payloads, provider metadata, and token
diagnostics remain in Details.

Accepted ADR 016 changes presentation and progress messaging only. It adds no Agent authority,
tool, event type, persistence, migration, worker role, background job, or filesystem/network
access. The user explicitly requested this redesign on 2026-08-12 using the Codex task surface as
the interaction reference. On 2026-08-12 the user additionally authorized a local unsigned macOS
App build from the current CP28.2 worktree. Commit, tag, push, hosted CI, signed release, and
promotion remain unauthorized.

Local evidence includes 26 focused policy, view-model, and Renderer tests; `check:fast`;
`check:electron` with 135 passing Electron-hosted test files, 716 passing tests, one opt-in
benchmark skipped, and a successful production build; a fresh full Real-Electron gate with all 23
scenarios passing without flakes or skips; all 23 recovery fixtures verified; a clean scoped
Impeccable detector; and `git diff --check`. The Agent E2E proves the visible context, approval,
model, Thinking, and Writing Skill controls, alternating progress messages and tool activity,
expandable human-readable steps, and the existing grounded proposal flow. It also exposed and
verified a fix that isolates the composer and Details Writing Skill popover state. The authorized
no-identity macOS arm64 package gate then passed 12/12 packaged runtime smoke scenarios and 15/15
packaged Real-Electron scenarios, verified app.sqlite integrity and no Apple Team identity, and
produced the unpacked App, DMG, ZIP, and package evidence from source revision `daff1fc` plus the
documented dirty CP28.2 worktree. Signed release, hosted CI, commit, tag, push, and promotion were
not run.

Checkpoint 28.1 is locally complete. It turns the existing Agent sidebar into one continuous writing
flow: opening resumes the active or attention-requiring conversation, empty projects show a lazy
draft composer, conversation history moves into a searchable header switcher, context scope is
inferred behind one editable control, and runtime metadata moves into progressive disclosure.
Running messages queue by default, while proposal review becomes a focused composer with Apply and
continue as the primary action and bounded feedback-driven revision as a new immutable run.

Accepted ADR 015 preserves Agent Harness Protocol v4, typed proposal and revision boundaries,
request-scoped execution, existing persistence tables, and the fixed worker roles. The checkpoint
adds no Agent tool, database migration, direct-write authority, durable job, subagent, plugin,
shell, or arbitrary filesystem/network access. The user approved the decision-complete plan and
explicitly requested implementation on 2026-08-12.

Local evidence includes 90 focused contract, provider-catalog, Main/IPC, session-service, view-model,
and Renderer tests; `check:fast`; `check:electron` with 135 passing Electron-hosted test files, 715
passing tests, one opt-in benchmark skipped, and a successful production build; a fresh full
Real-Electron gate with all 23 scenarios passing without flakes or skips; the grounded Agent flow
covering Request changes, a new revision run with re-authorized evidence, Apply and continue, one
accepted manuscript mutation, reopen, Undo, archive, and restore; a clean scoped Impeccable
detector; and `git diff --check`. Packaging, release, hosted CI, commit, push, and promotion were
not run during implementation. On 2026-08-12 the user authorized the local `v0.2026.8.12` commit,
tag, and macOS arm64 App build. The no-identity unpacked package gate passed 12/12 packaged runtime
smoke scenarios and 15/15 packaged Real-Electron scenarios, with bundle version `0.2026.8`, build
`2026.8.12`, and no Apple Team identity. Push, hosted CI, signed release, and promotion remain out
of scope.

Checkpoint 27.9 remains locally complete. It replaces the editable section heading's single-line
input with an unbounded soft-wrapping shadcn textarea that grows with its content while retaining
the existing 500-character title contract. Enter saves the title and moves focus into the section
body; pasted line breaks are normalized to spaces so section titles remain logical single-line
metadata. The sidebar and outline tree retain their compact single-line navigation treatment. This
checkpoint is Renderer-only and does not change manuscript persistence, IPC, export, or Agent
behavior.

The user approved the decision-complete plan and explicitly requested implementation on
2026-08-11. Local evidence includes the focused desktop/narrow-window Real-Electron scenario;
`check:fast`; `check:electron` with 134 passing Electron-hosted test files, 704 passing tests, one
opt-in benchmark skipped, and a successful production build; a clean scoped Impeccable detector;
and scoped `git diff --check`. Packaging, release, hosted CI, commit, push, and promotion remain out
of scope.

Checkpoint 27.8 is locally complete. It replaces generic numbered Agent conversation labels with a
bounded, request-scoped title flow and completes the already-present active/archived session
lifecycle. The first prompt produces an immediate local fallback title while one non-blocking
single-shot request through the conversation's selected Agent model may replace it; manual
regeneration uses bounded durable history. Active and archived conversations remain project-local,
archiving is reversible and idle-only, and archived history is read-only. The checkpoint reuses
`agent_sessions` and `model_requests`; it adds no table, Agent tool, durable job, provider role, or
independent title-model setting.

The user approved the decision-complete plan and explicitly requested implementation on
2026-08-11 after confirming Checkpoint 27.7 acceptance. Local evidence includes 54 focused title,
archive, contract, broker, and IPC tests; `check:fast`; `check:electron` with 133 passing
Electron-hosted test files, 697 passing tests, and one opt-in benchmark skipped; a successful
production build; 22/22 full Real-Electron E2E scenarios including automatic/manual title flows,
keyboard menus, archived read-only history, and restore; a clean Impeccable detector; and
`git diff --check`.

A same-day packaged-runtime follow-up reproduced title generation failures with selected reasoning
models. The title transport had applied a non-reasoning profile universally: Codex Responses
rejected the explicit temperature while a DeepSeek reasoning model exhausted the 64-token budget
without visible title text. Title requests now use catalog reasoning metadata: non-reasoning models
retain the 64-token deterministic profile, while reasoning models omit the incompatible temperature
and receive a bounded 512-token transport allowance; the durable title remains sanitized to 80
Unicode characters. Worker failures also preserve the provider diagnostic for safe Main-process
logging. The user authorized a fresh local App build. Follow-up evidence includes 36/36 focused
service/worker tests, `check:fast`, the complete `check:electron` gate, the 23-case recovery-fixture
verifier, and an unsigned macOS arm64 unpacked package with all 12 packaged smoke scenarios and
15/15 packaged E2E scenarios passing. Release, hosted CI, commit, push, and promotion were not run.

Checkpoint 27.7 is locally complete. The editable section editor recognizes the canonical English
and Chinese readable citation labels as ordinary text and adds non-destructive ProseMirror
decorations with mouse and keyboard activation. Main resolves previews only from accepted proposal
provenance attached to the stable block along the bounded revision lineage, expands the persisted
`citationId` values through the active index, and uses NFC-and-trim exact title plus optional page
matching. The resolver does not guess from project-wide titles; copied or manually authored labels
without qualifying provenance remain highlighted and report an unavailable association. The
checkpoint does not change the manuscript schema, citation policy, autosave/revision behavior,
Markdown round-trips, or whole-manuscript preview.

Local evidence includes a frozen dependency install; 23 focused parser, extension, resolver, IPC,
session-validation, and safe-logging tests; `check:fast`; `check:electron` with 132 passing
Electron-hosted test files, 686 passing tests, and one opt-in benchmark skipped; a successful fresh
production build; the focused grounded Agent Real-Electron scenario covering keyboard and mouse
preview activation, exact source content, focus restoration, reopen, and undo; a clean Impeccable
detector; and `git diff --check`. Package, release, hosted CI, commit, push, and promotion were not
run.

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
approval. Checkpoint 28.x and its local `v0.2026.8.13` tag/App build have that approval; do not
start a subsequent product checkpoint without new explicit user approval.

The current release-candidate identifier is `0.2026.8.13` (`v0.2026.8.13` as the Git tag). Its
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

- The planning-only post-Checkpoint-28 writing-experience roadmap lives in
  [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md). It changes no current
  Checkpoint 28 scope and does not authorize Checkpoint 29; activation requires recorded
  Checkpoint 28 acceptance and separate user approval.
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
