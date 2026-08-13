# WriteLLM Current Plan

Status: All authorized Phase 11 checkpoints through 47B and the final local macOS arm64 0.2026.8.16 App package are complete and verified. Checkpoint 26.9 is paused and all GitHub Actions workflows are disabled.
Recorded: 2026-08-13

This file describes only the active delivery state. Long-lived system rules belong in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence belongs in the
Phase files under [`implementation-todo/`](implementation-todo/); completed chronology belongs in
[`history/implementation-log.md`](history/implementation-log.md).

## Current checkpoint

Final Phase 11 verification and packaging is complete. Checkpoint 44 is complete under accepted
[`ADR 035`](adrs/035-project-local-manuscript-annotations.md): a small project-local annotation
authority keeps notes and TODOs outside manuscript bodies, preserves stable section/block anchors,
marks exact orphaning without fuzzy relocation, rolls back with project history, and lets the user
opt selected annotations into an ordinary Agent request. Checkpoint 46 is complete under accepted
[`ADR 036`](adrs/036-independent-project-clone.md): Save As creates a staged, verified independent
copy, rewrites every enumerated project identity, omits derived/private/transient state, and opens
the result through the normal project lifecycle. Checkpoints 47A and 47B are complete under
accepted [`ADR 037`](adrs/037-bounded-project-template-catalog.md): reviewed built-ins and a
hash-verified bounded user catalog apply only Brief structure, outline, Writing Rules, and an
optional publication-preset reference through normal project authorities. Templates never contain
manuscript bodies, knowledge, citations, Agent history, credentials, assets, private paths, or old
project identity.

Cumulative final evidence passed `check:fast`, the complete Electron-hosted gate and production
build, all 25 recovery fixtures from 23 sources, clean scoped Impeccable and diff checks, and all
38/38 fresh Real-Electron scenarios with no failures, skips, or flaky scenarios. The no-identity
macOS arm64 package gate verified Electron 43.1.0 / ABI 148, arm64 `better-sqlite3` and
`sqlite-vec`, the ASAR/resource inventory, 12/12 packaged smoke scenarios, and 26/26 E2E scenarios
against the unpacked App. It generated and structurally verified the 0.2026.8.16 App, DMG, and ZIP.

Checkpoint 37B is complete under accepted [`ADR 034`](adrs/034-contained-latex-project-import.md).
Main captures a bounded directory, archive, or direct-entry dependency closure; citation-js and
unified-latex run inside the existing disposable no-network worker; and includes, bibliography,
tables, figures, labels, and registered local images cross back only through the application-owned
neutral projection. Verification passed focused hostile/project tests, `check:fast`, 172
Electron-hosted files / 888 tests, the production build, 34/34 silent Real-Electron scenarios,
all 25 recovery fixtures, clean scoped Impeccable and diff checks, and the package gate. The
packaged App passed 12 smoke scenarios and 22/22 packaged E2E scenarios; the DMG and ZIP were
generated and structurally verified.

Checkpoint 37A is complete under accepted
[`ADR 033`](adrs/033-isolated-inert-latex-import.md): exact-pinned unified-latex parses one bounded
UTF-8 `.tex` source in a disposable utility process with hard timeout and cancellation. The
application-owned projection maps metadata, outline hierarchy, prose, emphasis, lists, quotes,
verbatim, and display math; inline math, footnotes, citations, comments, malformed syntax, custom
macros, and unknown constructs remain visible and inert with exact findings. Imported sections
remain ordinary editable `import` revisions. Verification passed 26 focused tests, `check:fast`,
172 Electron-hosted files / 884 tests, the production build, all 33 silent Real-Electron
scenarios, and all 25 recovery fixtures. Checkpoint 36 is complete under accepted
[`ADR 032`](adrs/032-session-bound-manuscript-import-staging.md): Main owns bounded source capture,
hashing, contained image resolution, exact-pinned remark mapping, a 30-minute session plan,
side-by-side review, atomic section creation, and optimistic active-section replacement. The
Renderer no longer reads or parses files. Verification passed 170 Electron-hosted files / 878
tests, the production build, and all 32 silent Real-Electron scenarios. Checkpoints 38 through 41B are complete: one ephemeral,
typed publication assembly now projects the exact captured manuscript, references, figures, and
verified assets; fail-closed preflight provides exact issue navigation; and the Main-owned export
boundary produces canonicalized editable DOCX packages with deterministic hashes and explicit
loss reports. The user explicitly authorized
the remaining Phase 11 sequence on 2026-08-13 and directed implementation to choose established
best practices without waiting for questions, prefer mature libraries where they reduce format or
runtime risk, and keep new capabilities as fixtures around the ordinary Agent loop. CP34A is now
complete under accepted [`ADR 025`](adrs/025-agent-writing-task-identity-and-plan.md): one bounded
conversation-scoped task, stable UUID task/step identities, optimistic monotonic plan versions,
ordinary Agent task tools, proposal correlation, and a passive plan projection. It adds no
scheduler, autonomous background loop, subagent, independent conversation type, or manuscript
authority. CP34B is now complete: exact run/task/step snapshots, authoritative proposal-derived
progress, explicit disagreement, optimistic idle plan revision, and same-conversation resume are
implemented without a second model flow. CP35A now groups existing correlated proposals by the
task boundary and adds read-only cross-section navigation over the current proposal review surface.
CP35A is complete: all proposal outcomes and stale refresh state remain explicit and each grouped
item returns to the ordinary exact proposal review. CP35B is complete under accepted
[`ADR 026`](adrs/026-agent-change-set-batch-sequencing.md): a Main-owned, durable, idempotent
sequence invokes only the existing per-proposal decisions, reports partial truth, stops on adverse
outcomes, supports optional ready-only history checkpoints, and deterministically reconciles undo
and restart without a second mutation engine. CP43A is complete under accepted
[`ADR 027`](adrs/027-figure-semantics-and-schema-v3.md): section content schema v3 provides stable
figure identity and explicit caption/alt metadata, old revision bodies remain unchanged and
readable, numbering is derived, and deterministic review findings target the exact figure. CP42
is complete under accepted [`ADR 028`](adrs/028-manuscript-asset-workspace-and-safe-deletion.md).
The existing immutable manuscript-asset authority now has a bounded workspace with validated
dimensions, session previews, current/history/proposal usage, filters, exact navigation, integrity
status, and crash-recoverable protected deletion. CP43B now adds candidate lineage and iteration
through the ordinary Agent image tool and proposal flow.

Final CP38/39 evidence includes typed golden projection coverage; focused publication, DOCX,
whole-export, IPC, and Renderer tests; independent OOXML parsing with JSZip/fast-xml-parser and
semantic reopen with Mammoth; byte-identical repeated canonicalized DOCX generation; `check:fast`;
and `check:electron` with 165 passing Electron-hosted files, 857 passing tests, three skipped
opt-in tests, and a production build. `docx@9.7.1`, `jszip@3.10.1`, and
`fast-xml-parser@5.10.1` are exact runtime pins; `mammoth@1.12.1` is an exact test-only pin.

Final CP40 evidence includes accepted ADR 030; deterministic CJK/Latin, escaping, injection,
formula, table, figure, citation, missing-bibliography, Mermaid, and listing-fallback fixtures;
whole-export, IPC, and menu integration; exact-pinned
`@unified-latex/unified-latex-util-parse@1.8.4` independent AST reopen; `check:fast`; and
`check:electron` with 166 passing Electron-hosted files, 860 passing tests, three skipped opt-in
tests, and a production build. No TeX compiler is installed or required by the product.

Final CP41A evidence includes accepted ADR 031; a real Electron 43 target-runtime spike proving
selectable CJK/Latin text, outline bookmarks, internal/external links, and two-pass TOC
destinations; focused conversion, cancellation, large-manuscript, export, IPC, and Renderer
coverage; `check:fast`; and `check:electron` with 167 passing Electron-hosted files, 868 passing
tests, three skipped opt-in tests, and a production build. The no-identity macOS arm64 package
gate passed all 12 packaged smoke scenarios and 19/19 packaged E2E scenarios, verified the ASAR
and arm64 native inventory, and produced the App, DMG, and ZIP. The gate also added permanent
regressions for sandbox-safe preload dependencies and schema-v3 packaged reopen.

Final CP41B evidence includes app migration v7; three immutable application presets; bounded user
preset CRUD and one default; strict versioned fail-closed options; settings in the global shadcn
Command surface; one default-resolution path shared by publication preflight and export; identical
source hashes across DOCX, LaTeX, and PDF for the same preset; focused repository/IPC/export tests;
`check:fast`; and `check:electron` with 168 passing files, 871 passing tests, three skipped opt-in
tests, and a production build. Preset changes touch only app.sqlite and never project revisions.

Final CP42 evidence includes focused migration, service, mutation, IPC, and Renderer coverage;
`check:electron` with 163 passing Electron-hosted test files, 851 passing tests, and three skipped
opt-in files/tests; a production build; focused and fresh full Real-Electron E2E with 31/31
scenarios; all 25 recovery fixtures from 23 sources; clean scoped Impeccable detection; and
`git diff --check`. The rich-media scenario proves asset listing, protected/current usage,
unprotected deletion, exact block navigation, and persistence through project reopen.

Final CP43A evidence includes focused migration, history, export, review, schema, and Renderer
tests; `check:electron` with 162 passing Electron-hosted test files, 848 passing tests, and three
skipped opt-in files/tests; a production build; fresh full Real-Electron E2E with 31/31 scenarios;
all 25 recovery fixtures from 23 sources; clean scoped Impeccable detection; and
`git diff --check`. The rich-media scenario proves metadata editing, persistence through project
reopen, native/Markdown export, stable identity, and safe preview rendering.

Final CP35B evidence includes focused migration, sequencing, crash-window, replay, IPC, and
Renderer tests; `check:fast`; `check:electron` with 160 passing Electron-hosted test files, 844
passing tests, and three skipped opt-in files/tests; a production build; fresh full Real-Electron
E2E with 31/31 scenarios; all 25 recovery fixtures from 23 sources; clean scoped Impeccable
detection; and `git diff --check`. The Agent writing-task scenario applies the real batch decision
surface and proves the durable result across archive/restore and application restart.

Final CP34A evidence includes `check:fast`; `check:electron` with 157 passing Electron-hosted test
files, 835 passing tests, and three skipped opt-in files/tests; a production build; focused and
fresh full Real-Electron E2E with 31/31 scenarios; all 25 recovery fixtures from 23 sources; clean
scoped Impeccable detection; and `git diff --check`. The new scenario proves stable task and step
identity across archive/restore, project close, and application restart.

Final CP34B evidence includes focused reconciliation, migration, IPC, and session tests;
`check:fast`; `check:electron` with 158 passing Electron-hosted test files, 839 passing tests, and
three skipped opt-in files/tests; a production build; focused and fresh full Real-Electron E2E with
31/31 scenarios; all 25 recovery fixtures from 23 sources; clean scoped Impeccable detection; and
`git diff --check`. The task scenario proves durable idle revision, plan-version advancement,
same-conversation resume through `get_writing_task`, exact resumed-run correlation, and restart.

Checkpoints 32, 45, and 33 are locally complete together under accepted
[`ADR 024`](adrs/024-agent-native-review-fixtures.md). They add a pure snapshot-driven
`check_draft` core, project-local Review Issues, versioned Brief-owned Writing Rules, bounded Agent
fixture tools, proposal-linked issue resolution, a static review policy, and a passive Workbench.
The Workbench uses standard shadcn loading, error, empty, form, pagination, and responsive
compositions and never starts model work. The ordinary Agent conversation remains the only model
execution surface; there is no special Agent session/run, hidden model call, durable review job,
independent report table, direct manuscript write, task engine, new worker, or provider runtime.

Final CP32/45/33 evidence includes `check:fast`; `check:electron` with 154 passing
Electron-hosted test files, 829 passing tests, and three skipped opt-in files/tests; a production
build; focused Agent-native and passive-Workbench scenarios; fresh full Real-Electron E2E with
30/30 scenarios; all 25 recovery fixtures from 23 sources; clean scoped Impeccable detection; and
`git diff --check`. The Real-Electron path proves the ordinary Agent
`check_draft → list_review_issues → record_review_issues` flow, durable semantic source lineage,
Workbench navigation and corrections, narrow responsive behavior, and Writing Rules persistence.

Citation compact-presentation maintenance is locally complete above the completed Checkpoint 28.6
baseline. Numbered/icon decorations no longer reserve excessive line height, and the Lucide icon
widget now has intrinsic geometry. Canonical citation text, numbering, copy/edit semantics,
settings, persistence, IPC, export, counts, and source resolution remain unchanged. Focused
Renderer coverage, `check:fast`, a production build, the focused Real-Electron citation scenario,
scoped Impeccable detection, and `git diff --check` passed.

Checkpoint 31 selection-based quick AI actions are locally complete under
[`ADR 023`](adrs/023-selection-based-quick-ai-actions.md) and the revised
[`Phase 11 plan`](implementation-todo/phase-11.md#checkpoint-31-selection-based-quick-ai-actions).
On 2026-08-12 the user explicitly authorized CP31 implementation. The checkpoint adds one
keyboard-accessible selection toolbar entry for bounded Main-owned rewrite, shorten, expand, tone,
evidence, manuscript-alignment, and custom-instruction templates. It reuses the currently visible
ordinary Agent conversation and the existing start-run, snapshot, proposal, review, stop, steer,
usage, model, Thinking, Writing Skill, context, and approval boundaries. A missing visible
conversation is created through the existing first-send path; a busy, archived, review-blocked,
unconfigured, or capacity-blocked conversation fails explicitly rather than routing elsewhere.

Renderer captures exact selected text, ordered block IDs, section, revision, and capture time,
checks that the selection remains identical across the editor flush, and displays the frozen
snapshot in the resulting normal user-message timeline item. Main revalidates the active section,
exact current revision, unique existing selected blocks, and selected text before constructing the
task prompt. The toolbar performs no provider call and cannot construct or apply a mutation.
Evidence review may finish successfully without a proposal. No dependency, migration, table,
durable job, provider runtime, Agent tool/schema, direct write, reusable prompt registry, package,
release, hosted CI, commit, tag, push, or publication was authorized or performed.

Local evidence includes the focused 55-test contract, prompt, Main, IPC, and Renderer suite;
`check:fast`; `check:electron` with 150 passing Electron-hosted test files, 816 passing tests, and
three skipped opt-in files/tests; a successful production build; a focused Real-Electron scenario
covering the keyboard command, exact-selection timeline snapshot, ordinary conversation reuse,
Main-owned evidence prompt, review-only success, and absence of a proposal; fresh full
Real-Electron E2E with 28/28 scenarios; all 25 recovery fixtures from 23 sources; clean scoped
Impeccable detection; and `git diff --check`. Release metadata and packaged artifacts were not
changed for CP31.

Checkpoint 30 safe manuscript-wide replacement is locally complete under accepted
[`ADR 022`](adrs/022-safe-manuscript-wide-replacement.md) and the revised
[`Phase 11 plan`](implementation-todo/phase-11.md#checkpoint-30-safe-manuscript-wide-replacement).
On 2026-08-12 the user explicitly requested CP30 implementation, a bump to the next local patch
build (`0.2026.8.15`), and an unsigned macOS App build for hands-on testing. This accepts ADR 022
and authorizes the implementation and local package verification described here. No migration,
dependency, hosted CI, signing/notarization, commit, tag, push, or publication is authorized.

The decision reuses CP29 semantic spans but does not treat every Find hit as writable. Ordinary
inline/table prose and rich-media captions are eligible. Title/objective, canonical citation,
link, code-block, inline-code, mixed-structure, and unchanged hits are shown with fixed skip reasons
and cannot be selected. Formula/Mermaid source and image identity remain outside the search
surface. Replacement is exact single-line text of 0-4,096 well-formed UTF-16 code units; empty text
means deletion, and CP30 adds no normalization, markup interpretation, regex, or semantic rewrite.

Main owns one complete opaque 15-minute plan per project session. It reruns the CP29 matcher after
the serialized active-body and pending-title flush, pages at most 2,000 exhaustive candidates,
fails rather than applying a partial/budget-exhausted plan, and defaults selection to empty. One
confirmed operation may select at most 500 eligible candidates across 100 sections. It revalidates
the exact outline version and every selected revision, block, original string, and range before
applying.

All selected canonical body changes append one `manual` / `manual_checkpoint` revision per
affected section in one immediate SQLite transaction; exact failure commits none. Counts, hashes,
asset references, and current pointers use existing manuscript authority. Materialization remains
post-commit repairable work and may return explicit pending-repair section IDs without implying a
partial canonical batch. A bounded, session-scoped capability provides per-section Undo only while
the replacement revision is still current; optional managed-project checkpoints are offered only
when history is already ready.

The implementation includes pure eligibility/transform, bounded planning, atomic application and
Undo, IPC/editor reconciliation, Find/Replace UI, and verification. The 30-sample disposable-
database performance fixture for 500 selections across 100 sections passed at p50 8.79 ms, p95
16.44 ms, and max 17.21 ms. Final evidence includes `check:fast`; `check:electron` with 148 passing
test files, 807 passing tests, three skipped opt-in files/tests, and a production build; fresh full
Real-Electron E2E with 27/27 scenarios; 25 recovery fixtures from 23 sources; clean scoped
Impeccable detection; and `git diff --check`. No dependency, migration, worker, durable job,
persisted plan/history table, manuscript index, provider call, Agent tool/schema, or Renderer
authority was added.

Checkpoint 29 is locally complete against the decision-complete plan recorded in
[`ADR 021`](adrs/021-manuscript-find-and-offset-source-map.md) and the
[`Phase 11 plan`](implementation-todo/phase-11.md#checkpoint-29-manuscript-wide-find-and-navigation).
On 2026-08-12 the user declared Checkpoint 28 complete and explicitly requested implementation.
The completed work remains bounded to ADR 021; migration, dependency, worker, index, package/release, hosted
CI, commit, tag, push, and publication work are not authorized.

The plan adds literal manuscript-wide Find over section titles/objectives and visible current-
revision BlockNote text, with section/subtree/status filters, bounded pagination, a workspace rail,
`Cmd/Ctrl+F`, and exact flush/revalidate/navigate/highlight behavior. It adds no regular expression,
fuzzy/semantic search, replacement, persisted search state, manuscript index, migration,
dependency, worker, durable job, or Agent tool/schema change.

The central technical decision is a two-layer offset source map:

```text
normalized/lowercased search-projection range
-> original visible-surface UTF-16 range
-> typed BlockNote text-node/property UTF-16 segments
```

Common NFC, length-preserving text uses one linear map. Only a surface with normalization or
lowercase length changes uses extended-grapheme atomic runs; candidates may not end inside a
non-reversible atom. Matching is locale-independent `NFC(...).toLowerCase()`, not NFKC, accent
stripping, transliteration, or full Unicode case folding. Semantic spans, original-slice hashes,
revision/outline authority, and active session are revalidated after the editor flush; navigation
never guesses a nearby occurrence.

The reproducible 1,000-section/10,419,993-byte benchmark passed after five warmups and 30 measured
samples on Node v24.18.0 arm64: p50 32.34 ms, p95 34.66 ms, and maximum synchronous Main slice
12.02 ms. Its 4,051 surfaces include 1,001 slow-path surfaces and one 75,000-UTF-16-unit
decomposed-Unicode surface. Final evidence includes focused Unicode/source-map/Main/Agent/Renderer
coverage; `check:fast`; `check:electron` with 146 passing test files, 798 passing tests, two opt-in
benchmarks skipped, and a production build; fresh focused and full Real-Electron E2E with all
26 scenarios passing; all 25 recovery fixtures from 23 sources; one clean scoped Impeccable
detector run followed by a fresh finish review and remediation; and `git diff --check`.
Package/release work is out of scope and was not run.

The active release metadata is now `0.2026.8.16`. Under the accepted platform mapping, the valid
package/application SemVer and macOS `CFBundleShortVersionString` remain `0.2026.8`, while the
macOS `CFBundleVersion` is `2026.8.16`. The user explicitly requested a local App build for
hands-on CP31 testing. The no-identity macOS arm64 package gate passed 12/12 packaged runtime smoke
scenarios, 17/17 packaged Real-Electron scenarios, and all 25 recovery fixtures; it verified the
arm64 native inventory and a no-Team-ID ad-hoc/linker signature, then produced the local App, DMG,
and ZIP. No commit, tag, hosted CI, Apple signing/notarization, push, publication, or promotion was
performed.

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
approval. Checkpoint 28.x, its local `v0.2026.8.13` tag/App build, CP29 implementation, and the
`0.2026.8.14` metadata advance and CP30/`0.2026.8.15` local App build have their recorded local
authorization. Do not start a later
product checkpoint or any hosted/release action without new explicit user approval.

The current release-candidate identifier is `0.2026.8.16`; no corresponding Git tag exists. Its
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

- The post-Checkpoint-28 writing-experience roadmap lives in
  [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md). CP29 is locally complete
  under accepted ADR 021; CP30 is locally complete under accepted ADR 022. Checkpoints 31-47
  remain planning-only and each requires later
  decision-complete refinement and separate user approval.
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
