# Phase 12: Use And Fix

Status: Checkpoint 62 is complete
Recorded: 2026-08-20

## Purpose

Phase 12 is an evidence-driven refinement phase after the complete Phase 11 feature roadmap. It
turns hands-on use into small, reviewable fixes and persists each material interaction decision
before implementation. It is not a pre-authorized feature backlog: one checkpoint is agreed,
implemented, and verified at a time, and later work requires fresh user direction.

## Operating Boundary

- Preserve the accepted local-first, Renderer-sandbox, proposal-review, project capability, and
  three-worker architecture.
- Prefer presentation and composition changes over new persistence or process boundaries.
- Record a new ADR before changing an accepted interaction decision; never rewrite completed ADRs
  to hide the change.
- Reuse official shadcn/ui `new-york` components and the established workspace shell.
- Keep provider, model, approval, and Writing Skill truth in their existing Main/project/app
  authorities; UI state must not become a second source of truth.
- Add no later checkpoint until concrete use evidence and explicit user approval define it.

## Checkpoint index

- [Checkpoint 48](#checkpoint-48-agent-composer-progressive-disclosure): Agent composer
  progressive disclosure and hands-on refinements.
- [Checkpoint 49](#checkpoint-49-agent-pending-follow-up-queue): pending Follow-up queue.
- [Checkpoint 50](#checkpoint-50-agent-tool-contract-reliability-and-scope-discipline): Agent tool
  contract reliability and scope discipline.
- [ADR 043 refinement](#adr-043-refinement-write-auto-and-yolo-approval-semantics): Write Auto and
  YOLO approval semantics.
- [ADR 044 refinement](#adr-044-refinement-live-approval-mode-reads-at-proposal-time): live
  approval-mode reads at proposal time.
- [Checkpoint 51](#checkpoint-51-pi-active-tool-loop-context-recovery): Pi active tool-loop context
  recovery.
- [Checkpoint 52](#checkpoint-52-knowledge-citation-coverage-checks): Knowledge citation coverage.
- [Checkpoint 53](#checkpoint-53-existing-image-cross-section-relocation): existing-image
  cross-section relocation.
- [Checkpoint 54](#checkpoint-54-harness-style-writing-context-compaction): writing context
  compaction.
- [Checkpoint 55](#checkpoint-55-agent-composer-context-usage-indicator): context-usage indicator.
- [Checkpoint 56](#checkpoint-56-agent-plan-bottom-progress-capsule): bottom progress capsule.
- [Checkpoint 57](#checkpoint-57-fixed-multi-provider-image-generation): fixed multi-provider
  image generation.
- [Checkpoint 58](#checkpoint-58-independent-markdown-preview-workspace): independent Markdown
  Preview workspace.
- [Checkpoint 59](#checkpoint-59-google-cloud-vertex-ai-nano-banana-image-source): Google Vertex AI
  Nano Banana source and hands-on repair.
- [Checkpoint 60](#checkpoint-60-observable-dynamic-writing-skills): observable dynamic Writing
  Skills.
- [Checkpoint 61](#checkpoint-61-textual-writing-skill-mentions): textual Writing Skill mentions.
- [Checkpoint 62](#checkpoint-62-flat-settings-reorganization): flat Settings reorganization and
  missing read-only support surfaces.

The completed CP62 record and newest CP60/61 handoff records are kept first below; CP48–59 then
retain their original delivery order. All listed checkpoints and refinements are complete.

## Checkpoint 62: Flat Settings Reorganization

Decision: user-approved bounded refinement under the existing ADR 009 Settings boundary;
implementation complete.

### User outcome

- Settings keeps one flat peer navigation list with no labeled group hierarchy or nested settings
  navigation.
- General reads in the order Appearance, Writing, and Agent defaults.
- Keyboard Shortcuts and About & Diagnostics make existing commands, application version,
  credential security, and sanitized support actions discoverable without adding new authority.

### Scope and implementation

- [x] Reorder the existing flat peer list, reorganize General, and remove duplicated security and
  diagnostic content from General.
- [x] Add read-only Keyboard Shortcuts and About & Diagnostics peer surfaces using existing
  Renderer-safe application/provider/diagnostics projections.
- [x] Add focused Renderer and Real-Electron coverage, inspect the desktop layout, and pass
  the authorized static, Electron, E2E, Impeccable, and diff gates.

### Local evidence

- The Settings Command contains one unlabeled ordered peer list. General uses Appearance, Writing,
  and Agent defaults fieldsets; credential security and diagnostics exist only on About &
  Diagnostics.
- Focused Renderer coverage passed five tests for navigation order, General composition, the fixed
  shortcut guide, secure credential state, and unsafe-backend warnings. The focused Real-Electron
  flow verified preference persistence, both new peers, close behavior, focus return, and WCAG axe
  checks.
- `pnpm check:fast` passed. `pnpm check:electron` passed 188 files / 1048 tests with three
  intentional benchmark skips and completed the production build. `pnpm check:e2e` passed all
  41 fresh Real-Electron scenarios with no flaky, skipped, or failed scenario.
- Desktop screenshots of Keyboard Shortcuts and About & Diagnostics were inspected. The scoped
  Impeccable detector returned no findings, and `git diff --check` passed.
  No shared contract, IPC, persistence, migration, dependency, package/release, hosted CI, commit,
  push, signing, notarization, promotion, or publication action ran as part of checkpoint
  completion.
- A later separately authorized hands-on build passed the no-identity macOS arm64 package gate from
  the current dirty worktree. Native/ASAR inventory, 12/12 packaged smoke scenarios, and 28/28
  packaged E2E scenarios passed before the gate produced the unpacked App, DMG, and ZIP. No
  candidate, commit, tag, push, Apple Developer ID signature, notarization, release, promotion, or
  publication ran.

### Acceptance gate

- The Settings list remains one unlabeled flat level in the approved order; provider readiness
  badges, close behavior, and focus return remain intact.
- The shortcut guide names only commands that current keyboard handlers implement and clearly
  states their availability context; shortcuts remain read-only.
- About shows bounded application name/version and credential-backend status. An unsafe backend
  preserves the existing warning, and diagnostics expose only opening logs and exporting the
  existing sanitized bundle.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, fresh complete Real-Electron coverage,
  desktop inspection, scoped Impeccable, and `git diff --check` pass. No package gate is
  required for this Renderer-only checkpoint.

### Explicit exclusions

No editor typography, content-width or retrieval preference, localization, shortcut customization,
automatic update, project-template or recent-project management, shared contract, IPC channel,
database migration, provider/worker change, dependency, package/release action, hosted CI, commit,
push, signing, notarization, promotion, or publication is authorized.

## Checkpoint 61: Textual Writing Skill Mentions

Decision: accepted ADR 055; implementation complete.

### User outcome

- Typing `$` at the start of a new Agent message opens installed Writing Skill autocomplete.
- Selecting a Skill inserts ordinary `$skill-name` text; the prompt has no hidden Skill attachment,
  badge, chip, dropdown state, or session preference.
- Main resolves the text and the Agent visibly loads requested guidance through
  `read_writing_skill` before it can answer or begin downstream work.

### Scope and implementation

- [x] Add the bounded leading-mention grammar, version-3 requested/load-source provenance, exact
  replay, and fail-closed Main preparation enforcement.
- [x] Add idle-composer shadcn Command autocomplete using the existing safe Skills snapshot while
  leaving slash context commands and active-run inputs unchanged.
- [x] Extend timeline/Details provenance and focused shared, Main, Renderer, and Real-Electron
  coverage without exposing Skill bodies, virtual URIs, private paths, or new authority.
- [x] Pass static, Electron, E2E, recovery, desktop visual, Impeccable, and diff gates and record
  exact local evidence.

### Local evidence

- Shared/parser, v1/v2/v3 contract normalization, Main routing, session preparation, replay,
  Renderer matching, and error-projection tests cover leading and escaped mentions, ordered
  multi-Skill loads, explicit-only Skills, conflicts, unavailable and excessive mentions,
  prompt/reference budgets, dependencies, and fail-closed final answers.
- The fresh Real-Electron fixture selected two Skills using Enter and Tab, retained the ordinary
  `$e2e-writing $e2e-humanize` prompt text in the model request, visibly loaded both requested
  Skills plus one Agent-discovered complement, read five complete references, and projected two
  Requested plus one Discovered provenance row in Agent Details.
- `pnpm check:fast` passed. `pnpm check:electron` passed 187 files / 1043 tests with three
  intentional benchmark skips and completed the production build. `pnpm check:e2e` passed all 41
  fresh Real-Electron scenarios with no flaky, skipped, or failed scenario. All 25 recovery
  fixtures from 23 sources passed.
- Desktop and Agent Details screenshots were inspected; the scoped Impeccable detector returned no
  findings, and `git diff --check` passed. No tag, package, release, hosted CI, commit,
  push, signing, notarization, promotion, or publication action ran.

### Acceptance gate

- Up to four distinct leading `$name` mentions remain verbatim prompt text and resolve in order;
  escaped and unknown tokens grant no Skill authority, while ambiguous, unavailable, or excessive
  recognized mentions fail before content is disclosed to the model.
- Requested and explicit-only Skills enter context only through named tool calls. Pending requests
  and dependencies block downstream tools and final answers; automatic discovery may continue only
  after the requested prefix settles and within the existing shared budgets.
- Retry and restart preserve pinned requested versions and user/Agent load sources through v3;
  v1/v2 history remains readable without a project migration.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, fresh complete Real-Electron coverage,
  recovery fixtures, desktop inspection, scoped Impeccable, and `git diff --check` pass. No
  package/release gate is required.

### Explicit exclusions

No session or per-message Skill selection object, chip, badge, executable content, arbitrary
filesystem/network/shell access, hidden route model, new provider/tool/dependency, migration,
package/release action, hosted CI, commit, push, signing, notarization, promotion, or publication is
authorized.

## Checkpoint 60: Observable Dynamic Writing Skills

Decision: accepted ADR 054, superseding ADR 053's session-selection interaction; implementation
complete.

### User outcome

- The composer has no Writing Skill selector, badge, chip, or persistent mode.
- Every run gives the Agent a bounded metadata catalog. A user may name a Skill in ordinary
  language, or the Agent may discover one, but guidance enters the run only through the same visible
  `read_writing_skill` tool process.
- The timeline names every entrypoint, dependency, and reference actually loaded; Agent Details
  preserves read-only exact run provenance after reinstall, rename, or removal.

### Scope and implementation

- [x] Add version-2 actual-load snapshots and historical normalization without new session state or
  a project migration; remove the unshipped selection persistence and IPC.
- [x] Replace the single-primary runtime lock with tool-only ordered composition, separately visible
  dependency/reference reads, exact cross-Skill allowlists, twelve-file/32-KiB reservations,
  prompt-budget checks, replay, preparation barriers, and safe structured lifecycle logs.
- [x] Remove every composer/Details Skill control and badge; add named dynamic loading activity plus
  read-only Agent Details provenance using existing shadcn primitives.
- [x] Add focused contract, migration, Main/runtime, Renderer, and Real-Electron coverage and pass
  the authorized static, Electron, E2E, UI, Impeccable, and diff gates.

### Local evidence

- Version-2 actual-load snapshots, version-1 normalization, exact replay candidates, ordered
  top-level/dependency provenance, and retained reference hashes are covered by focused shared,
  Main/router, worker, session, and Renderer tests. No migration 0037 or session selection IPC is
  present; legacy migration 0026 columns are ignored rather than becoming current product state.
- The Real-Electron Skill fixture loaded two top-level Skills and five complete reference files via
  visible `read_writing_skill` calls. It verified no composer or Details selection control, the
  aggregate timeline activity, safe persisted projections, and read-only Agent Details provenance.
- `pnpm check:fast` passed. `pnpm check:electron` passed 186 files / 1031 tests with three
  intentional benchmark skips and completed the production build. The final `pnpm check:e2e`
  passed all 41 fresh Real-Electron scenarios with no flaky, skipped, or failed scenario.
- Desktop and Agent Details screenshots were inspected using the established shadcn and Impeccable
  interaction criteria. `git diff --check` passed. No package/release gate, hosted CI,
  commit, push, signing, notarization, promotion, or publication ran.

### Acceptance gate

- No run inherits a Skill choice from a session or Renderer draft. Version-1 run snapshots remain
  readable; Retry uses the exact recorded versions, order, dependencies, and retained references.
- Dynamic discovery adds no hidden model request and at most one new entrypoint per Skill-only
  response. User-named and Agent-discovered Skills follow the identical tool path.
  Top-level plus dependency references are exact-URI-only, whole-file, idempotent, and cannot exceed
  twelve files, 32 KiB, or the 65,536-byte Skill prompt budget.
- The Renderer names actual Skill and relative-file loads, shows no idle Skill state, remains
  keyboard accessible, and receives no Skill body, virtual URI, private path,
  credential, or broader capability.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, production build, fresh affected
  Real-Electron coverage, bounded desktop visual inspection, scoped Impeccable, and
  `git diff --check` pass. No package/release gate is required.

### Explicit exclusions

No executable scripts, binary assets, arbitrary discovery, filesystem/network/shell authority,
skill-authored tool, route model, embedding classifier, marketplace, automatic update, selection
mode, multi-agent workflow, package/release action, hosted CI, commit, push, signing,
notarization, promotion, or publication is authorized.

## Checkpoint 48: Agent Composer Progressive Disclosure

Decision: accepted ADR 038; implementation and hands-on refinements complete.

### User outcome

The Agent composer is calmer and closer to the supplied Codex reference while continuing to state
WriteLLM's real, narrower authority. Approval policy is understandable, model plus effort is one
choice with a concise label such as `GPT 5.6 Sol xhigh`, and context/Writing Skill actions are
available from both Add and a leading slash.

### Scope

- [x] Document the Add/approval/model-effort/slash interaction and its authority limits in ADR
  038, including why ADR 016's always-visible control placement is amended.
- [x] Replace the two-row idle composer configuration with four top-level action groups: Add,
  approval, model plus effort, and Send.
- [x] Combine model and Thinking selection into one progressive popover; omit provider branding
  from the collapsed trigger but retain provider grouping where ambiguity matters.
- [x] Give approval choices accurate names and descriptions without implying arbitrary computer,
  filesystem, shell, or network access.
- [x] Apply ADR 039 after hands-on use: restore the compact `Manual`, `Section`, and `YOLO`
  approval labels, remove the shield icon, and prevent approval/model/Send overlap in the
  configured desktop Agent panel.
- [x] Apply ADR 040 after hands-on use: replace the idle paper-plane-plus-text Send control with a
  primary circular upward-arrow button while preserving its accessible name and existing behavior.
- [x] Implement one shared Add/slash command catalog for context scope and Writing Skill, with
  keyboard navigation, IME-safe behavior, disabled states, and no hidden prompt mutation.
- [x] Add focused Renderer coverage, update affected Real-Electron expectations, run the smallest
  applicable static/Electron/UI/diff gates, and record exact evidence.

### Acceptance gate

The default idle composer has one visual row below the prompt and keeps Send dominant. A model with
reasoning displays the exact selected model name plus lower-case Thinking token; an unsupported
model exposes no fake effort choice. Model switching clamps through the existing Main authority.
Every approval label and description matches the current proposal policy. Add and `/` route to the
same context and Skill actions, Escape closes the slash menu, arrow/Enter selection works through
the shadcn Command primitive, and ordinary slash-containing prose is unaffected. Existing run,
queue/steer/stop, review, session-lock, and Details behavior remains intact.

The ADR 039 refinement additionally requires the collapsed and menu approval titles to read
`Manual`, `Section`, and `YOLO`; no approval icon is shown; descriptions remain behaviorally
accurate; and each footer control stays within its allocated box in the configured desktop Agent
panel.

The ADR 040 refinement requires the idle Send action to use an icon-only circular upward arrow,
retain the accessible name `Send` and all disabled states, and leave running-state Queue, Steer,
retry, and Stop controls unchanged.

This checkpoint adds no migration, IPC method, tool, model request, prompt, provider capability,
dependency, package/release work, hosted CI, commit, push, or publication action.

### Local evidence

Implementation and runtime verification are complete. Three focused Renderer files passed 13
tests. `pnpm check:electron` passed 179 test files / 915 tests with three opt-in benchmarks skipped,
then completed the production build. Fresh focused Real-Electron runs passed the grounded Agent
workflow, outdated-proposal refresh, and Thinking-level memory scenarios; they verified the
one-row composer, Add context routing, slash filtering and Enter selection, truthful approval
descriptions, model/effort summary, unsupported-effort state, and a persisted lower-case `high`
trigger label. Two bounded screenshot rounds covered the default composer plus slash, approval,
and model/effort popovers. The scoped Biome pass covered all seven changed TypeScript/E2E files,
the full 594-file Biome pass succeeded with JSON formatting disabled, the Impeccable detector
returned no findings, and `git diff --check` passed.

At this intermediate verification point, ordinary `pnpm check:fast` also reported formatting in a
user-owned concurrent `.vscode/settings.json` edit, which was intentionally preserved. TypeScript,
all scoped code formatting/lint rules, full Electron tests/build, focused E2E, UI inspection, and
diff checks passed. The subsequent ADR 039/040 refinements, final hands-on rebuild and commit, and
later repository-wide green gates closed Checkpoint 48; no package or release gate was required for
the Renderer-only implementation itself.

### Hands-on App build authorization

On 2026-08-13 the user explicitly authorized one local no-identity macOS arm64 unpacked App build
from the current Checkpoint 48 worktree. The build must use the repository package gate so the
bundle, native inventory, packaged runtime smoke, and packaged E2E are verified before handoff. It
does not authorize a DMG, ZIP, Apple identity discovery, signing, notarization, hosted CI, commit,
push, release, or promotion.

The authorized build completed at `2026-08-13T19:52:34.612Z` from the current dirty worktree at
revision `771b643b01247150f53ec1f592ff4abaa4f1acc4`. `pnpm build:unpack` verified Electron
43.1.0 / ABI 148, arm64 `better-sqlite3` 12.11.1 and `sqlite-vec` 0.1.9, 45,783 ASAR entries,
all 12 packaged smoke scenarios, and all 26 packaged E2E scenarios with zero flaky, skipped, or
failed results. The bundle reports version `0.2026.8` / build `2026.8.16`, has no Apple Team ID,
and is available at `dist/macos-arm64/mac-arm64/WriteLLM.app` (857 MB as reported by `du`). The
evidence ASAR SHA-256 is `597395e60d7aa3eec011a3b0cf43ee07b4c28ccb442a9a26f3255d345e0f93ad`.
No DMG, ZIP, signing identity discovery, notarization, hosted CI, commit, push, release, or
promotion was performed.

### ADR 039 refinement evidence

The hands-on approval shorthand and desktop-width refinement is complete. Scoped Biome passed
the two changed Agent components and affected E2E file. Two focused Renderer files passed 11
tests, and `pnpm check:electron` passed 179 test files / 915 tests with the same three opt-in
benchmarks skipped before completing the production build. A fresh focused Real-Electron Agent
workflow passed with zero flaky, skipped, or failed scenarios; it asserted `Manual`, `Section`, and
`YOLO`, one disclosure icon only, the three truthful descriptions, and non-overlapping approval,
model, and Send bounds in the configured desktop panel. Screenshot inspection confirmed the compact
default row and approval menu. The Impeccable detector returned no findings and `git diff --check`
passed. No second App package, release, hosted CI, commit, or push was run.

### ADR 040 refinement evidence

The circular idle Send refinement is complete. Scoped Biome passed the changed Agent component
and E2E file, and the two focused Renderer files passed 11 tests. The first full Electron run
reported one unrelated 5-second timeout in the existing manuscript-export malformed-read-back
case while 914 tests passed; that exact case passed alone in 428 ms, and the complete rerun then
passed 179 test files / 915 tests with three opt-in benchmarks skipped before completing the
production build. Two fresh focused Real-Electron passes completed the grounded Agent workflow
with zero flaky, skipped, or failed scenarios. Runtime assertions verified the `Send` accessible
name and title, circular class, Lucide upward-arrow icon, empty visible label, enabled state, and
the existing non-overlap bounds. Screenshot inspection covered both disabled and enabled button
states in the configured desktop panel. The Impeccable detector returned no findings and the final diff
check passed. Queue, Steer, retry, and Stop were unchanged; no second App package, release, hosted
CI, commit, or push was run.

### Final hands-on rebuild and commit authorization

On 2026-08-13 the user explicitly authorized a fresh no-identity macOS arm64 unpacked App build
containing the ADR 039/040 refinements, followed by one local commit of the Phase 12 Agent composer
work and the already recorded application-icon assets. The unrelated concurrent
`.vscode/settings.json` and `section-editor.tsx` edits remain outside that commit. Push, tag,
signing, notarization, hosted CI, release, and promotion remain unauthorized.

The final rebuild completed at `2026-08-13T20:25:44.828Z` from the current dirty worktree at
revision `771b643b01247150f53ec1f592ff4abaa4f1acc4`. `pnpm build:unpack` verified Electron
43.1.0 / ABI 148, arm64 `better-sqlite3` 12.11.1 and `sqlite-vec` 0.1.9, 45,783 ASAR entries, all
12 packaged smoke scenarios, and all 26 packaged E2E scenarios with zero flaky, skipped, or failed
results. The final bundle reports version `0.2026.8` / build `2026.8.16`, has no Apple Team ID,
and is available at `dist/macos-arm64/mac-arm64/WriteLLM.app` (865 MB as reported by `du`). The
final evidence ASAR SHA-256 is
`71d4df714ffe8ff279f9c79aa6cf22bcfc7b856591a3a050b8f0408e40cdfd1a`. No DMG, ZIP, signing
identity discovery, notarization, hosted CI, push, release, or promotion was performed.

The authorized local Phase 12 commit was then created with the scoped Agent composer, ADR/Phase
documentation, affected tests, and already recorded application-icon assets. The unrelated
concurrent `.vscode/settings.json` and `section-editor.tsx` edits remain uncommitted. No push, tag,
signing, notarization, hosted CI, release, or promotion was performed.

## Checkpoint 49: Agent Pending Follow-up Queue

Decision: accepted ADR 041; implementation complete.

### User outcome

While an Agent run is active, ordinary Enter queues the draft into an addressable waiting list
above the composer. Authors can inspect multiple pending messages, delete one without affecting the
others, or promote any one to Steer. The footer uses one terminal position: Stop when the draft is
empty and the circular ArrowUp queue action when it is not.

### Scope

- [x] Record ADR 041 and amend the architecture before changing the accepted running-composer and
  queue boundary.
- [x] Add a bounded Main-owned pending queue, a worker mirror with one Pi Follow-up head, correlated
  delete/promote commands, and a persist-before-provider consumption barrier.
- [x] Project pending items through the activity snapshot and add capability-bound Preload IPC for
  per-item Steer and Delete.
- [x] Replace the running Queue disclosure with the Stop-or-Send action and a three-row-height,
  internally scrolling pending list above the composer.
- [x] Add focused contract, service, worker, Renderer, and Real-Electron coverage; run the
  applicable static, Electron, UI, and diff gates; record exact evidence.

### Acceptance gate

One active run accepts no more than 20 pending Follow-ups or 1 MiB of aggregate UTF-8 content.
Multiple items retain FIFO order; deleting the head, middle, or tail affects only that item;
Steering any item removes it from Follow-up order and injects it at the next available Steering
position. The worker never starts the corresponding provider call before Main durably appends the
consumed user message. Deleted and run-cancelled items never enter conversation history and their
pre-authorized model requests become aborted.

The running footer shows Stop for an empty draft and ArrowUp for a non-empty draft. Enter queues,
Cmd/Ctrl+Enter steers directly, and Shift+Enter inserts a newline. Queue success clears the draft;
failure preserves it. The pending list restores after panel or conversation switching, remains
usable in the configured desktop Agent panel, and disappears without leaving space when empty.
Stop, review pause, run failure, project close, worker termination, and relaunch clear the
request-scoped queue. No migration, dependency, worker role, background job, package, release,
hosted CI, push, or publication work is authorized.

### Local evidence

- `pnpm check:fast` passed the all-file Biome gate plus Node and Renderer typechecks.
- Focused contract, Main, IPC, model-client, worker, and Renderer runs passed; the final focused
  runtime rerun reported 3 files / 72 tests after model-request capability revocation was added.
- `pnpm check:electron` passed 179 test files / 922 tests with 3 opt-in benchmarks skipped, then
  completed the production Electron/Vite build. The expected non-fatal macOS
  `task_name_for_pid` diagnostics did not interrupt Vitest.
- The freshly built focused Real-Electron scenario passed 1/1. It queued two visible messages,
  deleted one, promoted the other, verified the promoted content reached the next provider request,
  and verified the deleted content did not. The same scenario passed in both preceding all-scenario
  attempts.
- Two full fresh E2E attempts reached 36/38 and 37/38. The only repeated failure, reproduced alone,
  is the pre-existing Writing Skill picker popover remaining open and intercepting the Agent details
  Close click; one independent References fixture failed only on the first attempt and passed on
  the second. Neither path exercises pending messages or the changed runtime protocol.
- An original-resolution Agent-panel screenshot with two queued rows showed no overlap; the list,
  Steer/Delete actions, composer controls, and circular Stop remained contained. The Impeccable
  detector reported `[]`, and `git diff --check` passed.
- No database migration, dependency, package/release gate, App artifact, commit, push, tag, signing,
  notarization, hosted CI, publication, or promotion action ran.

## Checkpoint 50: Agent Tool Contract Reliability And Scope Discipline

Decision: accepted ADR 042; implementation complete after independent Checkpoint 49 closure.

### Hands-on evidence

The screenshot run recorded 69 tool attempts, including 27 Pi-local preflight failures and ten
dispatched execution errors. Subsequent continuation runs raised the conversation total to 187
attempts, 69 preflight failures, and twelve execution errors. `submit_section_change` caused 68 of
the 81 explicit failures, `submit_outline_change` caused twelve, and `read_writing_skill` caused
one. In the primary run, 19 of 27 section preflight failures clearly omitted the operation-level
`anchor`; later calls used fabricated or stale block preconditions. Five outline submissions hit
the reproducible mismatch in which normalization counts the moving node but simulation has already
removed it. Both SQLite integrity checks passed, and successful calls in the same conversation
exclude a provider-wide or database-wide failure.

Across the project database, 347 attempts exercise only 14 of the 20 model-visible tools. Section
submission failed 68/90, outline submission 14/23, historical contract-v3 image generation 11/19,
and Writing Skill reads 2/9; the other ten exercised tools recorded no failures, while six tools
have no hands-on sample. The current generated tool envelope is 55,220 bytes and section submission
alone is 25,140 bytes because it embeds the recursive BlockNote schema. No generated field has a
description, and at least nine cross-field Zod refinements are absent from the JSON Schema that Pi
validates. CP50 therefore covers the entire tool surface rather than assuming unexercised tools are
correct.

The original request covered only the Brief and outline. After approval, the generic continuation
prompt, a null writing task, `check_draft` completeness findings, and the selected Writing Skill
combined to widen the run into section-body drafting. The UI then hid dispatched error details
behind `Proposal could not be prepared`, while undispatched failures appeared only as durable
diagnostic events and not as useful timeline entries.

### User outcome

Every model-visible tool exposes a compact, accurate smallest-valid call, prerequisite source,
default/empty behavior, and tool-specific recovery path. An empty-section write succeeds without
an invented anchor; a valid outline move reaches review; image insertion and iteration no longer
share irrelevant required fields; and stateful Skill/review/task tools tell the model exactly which
authorized read can recover a conflict. Approval of a Brief or outline proposal continues only
unresolved work in the user's original scope. If any tool still fails, the conversation shows a
safe actionable reason instead of an unexplained generic marker.

### Failure-to-fix map

| Evidence | Responsible boundary | Checkpoint 50 design |
| --- | --- | --- |
| Missing `insertTextBlocks.anchor` fails before Main | Model-visible section contract | Default omitted anchors to `null`, state root/anchored placement invariants, and publish a minimal empty-section shape |
| `last` move is normalized one position past the simulator range | Outline argument normalization | Remove/compact the moving node before resolving destination placement and freeze sequential provisional-state tests |
| JSON Schema drops Zod cross-field refinements | All model-visible schemas | Keep Pi preflight broad, prove every standard Main-valid fixture passes it, and return precise Main errors for domain invariants |
| Section schema consumes 25,140 of 55,220 envelope bytes | Model request tool envelope | Keep canonical payload opaque to the model schema, validate it fully in Main, and enforce 48 KiB/8 KiB envelope budgets |
| Image iteration requires irrelevant anchor/placement fields | `generate_image` model contract | Split insertion and iteration modes; derive iteration placement from exact source/disposition |
| Skill/review/task conflicts lack exact recovery | Structured tool error mapping | Return the authorized tool/URI or latest-version read and cap recovery at one retry |
| Brief/outline approval expands into section drafting | Application and approval-continuation policy | Make continuation Main-owned and scope-preserving; keep Skill and `check_draft` findings advisory |
| Generic or invisible preparation failure | Worker event diagnostics and Renderer projection | Add bounded optional diagnostics to the existing preflight event and render safe dispatched/preflight reasons |

### All-tool audit matrix

| Tool | Hands-on evidence | CP50 disposition |
| --- | --- | --- |
| `get_writing_context` | 15 calls / 0 failures | Freeze `{}` defaults, exact active-section behavior, and null/empty success semantics |
| `read_outline` | 5 / 0 | Document subtree depth, snapshot cursor, empty subtree, and same-tool pagination recovery |
| `read_section` | 94 / 0 | Encode summary/canonical/fragment as distinct modes and mark returned block ID/hash/revision provenance |
| `search_knowledge` | 56 / 0 | Represent page ordering; define no-hit and rerank-unavailable success without evidence invention |
| `search_manuscript` | no project sample | Add query/filter/cursor contract fixtures and empty-result semantics |
| `read_citations` | 15 / 0 | Keep flat inputs with one shallow required-anyOf; enforce actual non-empty and count rules in Main |
| `read_writing_skill` | 9 / 2 | Return the exact next authorized virtual URI for entrypoint/reference phase recovery |
| `inspect_change` | 1 / 0 | Require an exact same-session proposal ID and define pending/terminal outcomes |
| `check_draft` | 8 / 0 | State that empty checks means all applicable checks and that findings are diagnostic-only |
| `list_review_issues` | 7 / 0 | Define empty filters, pagination, and authoritative version refresh |
| `record_review_issues` | no project sample | Keep flat candidates and make Main's ID/version pairing error self-contained |
| `update_review_issues` | no project sample | Freeze action/status transitions and refresh conflicts through `list_review_issues` |
| `get_writing_task` | 4 / 0 | Make `{}` canonical and `task: null` a normal successful result |
| `create_writing_task` | no project sample | Require unique client refs and explain Main-assigned task/step IDs |
| `update_writing_task` | no project sample | Expose retained/new step modes, exact version, reason, and one-active-step invariants |
| `submit_brief_change` | 1 / 0 | Keep changes flat; make Main's non-empty error actionable and provenance-bound |
| `submit_writing_rules_change` | no project sample | Freeze operation modes, exact IDs, non-empty updates, uniqueness, and budget errors |
| `submit_outline_change` | 23 / 14 | Fix sequential provisional placement and clientRef/citation/ref recovery |
| `submit_section_change` | 90 / 68 | Repair insertion defaults, compact canonical schema, exact block provenance, and citation guidance |
| `generate_image` | 19 / 11, all historical v3 | Separate insert/iterate schemas and freeze contract-v8 provider/anchor errors as correctly classified |

### Scope

- [x] Accept ADR 042 and amend the affected architecture clauses after independently closing and
  committing Checkpoint 49.
- [x] Audit every entry in `AGENT_MODEL_VISIBLE_TOOL_SPECS`: add a bounded Pi-style description,
  keep model schema broad, and prove every standard minimal/boundary Main-valid fixture passes
  generated-schema preflight.
- [x] Keep the complete serialized tool envelope at or below 48 KiB and each tool at or below 8
  KiB; replace the model-visible recursive canonical BlockNote definition with a bounded opaque
  object while preserving full Main validation and the current-run canonical-read prerequisite.
- [x] Harden all read/context/review/task tools as specified in the matrix, including explicit
  empty/default/pagination semantics and exact version/URI/ID recovery for the six tools without
  current hands-on evidence.
- [x] Make `anchor` optional with `null` default for model-visible text/rich insertion, enforce
  root `start`/`end` versus anchored `before`/`after`, retain exact block-hash concurrency, and add
  provider-neutral field descriptions plus one-sentence empty-section guidance to the existing tool.
- [x] Correct sequential outline provisional ordering for create, move, and delete operations,
  including same-parent and cross-parent moves, without weakening mutation simulation.
- [x] Split `generate_image` into structurally explicit new-insertion and iteration modes, remove
  irrelevant iteration anchor/placement input, and verify contract-v8 provider failures never use a
  read-tool error code.
- [x] Move the fixed approval-continuation instruction out of Renderer authorship, remove its
  unconditional `check_draft` direction, and make application scope outrank Writing Skill and
  diagnostic completeness guidance.
- [x] Make structured recovery tool-aware across all tools; extend `tool_preflight_failed` and the
  existing persisted result error with optional safe diagnostic/recovery fields, log only bounded
  correlated metadata, and project both failure phases into the Agent timeline.
- [x] Add focused schema, normalizer/simulator, prompt, worker/event compatibility, Renderer, and
  Real-Electron regression coverage; run the applicable gates and record exact evidence.

### Contract details

All 20 tools receive a compact description of purpose and authority, output/empty semantics,
prerequisites, and recovery. Defaults are omitted from JSON Schema `required`. Model schema is
strict at object boundaries but intentionally wider than Main for simple non-empty, pairing,
ordering, state, version, and business invariants. No structured guidance layer, compiler, or JSON
call example is added. The full serialized envelope must not exceed 48 KiB and no one tool may
exceed 8 KiB; the pre-fix baselines were 55,220 and 25,140 bytes respectively.

`read_section` and `generate_image` use one flat union for their genuinely exclusive modes.
`read_citations` keeps flat inputs with at most one shallow required-anyOf. Review issue candidates,
Brief changes, knowledge page bounds, and writing-task business invariants remain flat and receive
authoritative Main errors. Main also retains byte limits, authorization, current snapshots, and
full canonical payload validation.

For an empty section, omit `anchor` and use root placement `start` or `end`; omission normalizes to
`null`. `start` and `end` are invalid when a non-null anchor is
present. `before` and `after` are invalid without an exact block precondition returned by the
relevant current-run read. Main never guesses a block, accepts a cross-section block, or relaxes a
hash mismatch. The same placement rule applies to rich-block insertion.

Outline operations are evaluated in array order. Moving a node first removes and compacts it in
the provisional source list, then resolves the destination against the resulting list. Deletion
also compacts before the next operation. A created `clientRef` becomes available only after its
create operation. Moving relative to self, an absent anchor, a non-sibling anchor, or a deleted
reference remains a bounded `invalid_arguments` failure.

The Main-owned continuation states that approval applies only the reviewed proposal and does not
grant additional mutation scope. It may continue remaining work expressly present in the
conversation, but an applied Brief/outline request is complete when no such work remains.
`check_draft`, review findings, writing-task metadata, and Writing Skills can constrain or advise
authorized work; none can introduce a new artifact or section-body mutation by themselves.

An optional preflight diagnostic contains one app-owned code and no more than 16 schema paths.
Argument values, validation-library strings, prompts/responses, document bodies, and absolute paths
are never persisted or logged. Persisted result errors may additionally retain their safe category
and recovery action/tool/attempt bound. Old events without these optional fields remain valid. No
new event type or database migration is required.

### Acceptance gate

- An inventory test proves exactly the 20 accepted tool names are registered, every tool has the
  required usage/recovery metadata, all defaults are optional to the model, all strict-object
  boundaries remain, and the 48 KiB/8 KiB schema budgets pass.
- A shared table of standard minimal and boundary-valid arguments passes generated JSON Schema and
  Main Zod for every tool, including all six tools without hands-on samples. Invalid fixtures must
  receive the expected Main code, self-contained message, and recovery; preflight need not reject
  them unless their basic shape is invalid.
- Read/context fixtures cover defaults, null/empty results, cursor restart, result truncation,
  exact provenance copying, and tool-specific conflict recovery. Review/task fixtures cover every
  permitted state transition and reject half-specified IDs/versions, lost step IDs, duplicate
  client refs, invalid reasons, and multiple active steps.

- A model-shaped empty-section text or rich insertion with omitted or explicit-null `anchor`
  reaches Main on the first attempt, produces the expected typed proposal, and preserves current
  citation and block-hash rules.
- Root/anchored placement combinations are exhaustively covered; fake, cross-section, deleted, and
  stale block preconditions fail safely and never mutate manuscript state.
- A table-driven outline matrix covers first/last/before/after for same-parent and cross-parent
  moves, moving the first/middle/last sibling, delete-then-move, create-then-move, no-op placement,
  and multiple operations. Every normalized result is accepted by the authoritative simulator.
- Image fixtures cover root and anchored insertion, replace and insert-after iteration, stale or
  missing source figures, provider unavailable/rejected behavior, contract-v8 error classification,
  and the absence of duplicate anchor/placement input in iteration mode.
- A deterministic Agent regression starts from a Brief-and-outline-only request, applies those
  proposals, supplies incomplete-section `check_draft` findings and a full-manuscript Writing
  Skill, and emits no `submit_section_change` call unless the user separately requested section
  prose.
- A conflict regression performs the relevant read and no more than one retry, never invents an
  ID/hash/tool name, and leaves a visible safe reason when it cannot proceed.
- Renderer tests show structured dispatched errors and safe preflight code/path details; replay of
  historical events without diagnostics is unchanged. Logs contain correlation IDs and bounded
  metadata but no argument or manuscript values.
- Focused tests pass before `pnpm check:fast` and `pnpm check:electron`. A fresh production build
  precedes the focused Real-Electron scenarios. Because the change crosses the Agent worker/event
  and packaged runtime boundary, `pnpm check:package` is the final local gate; `check:release`,
  hosted CI, signing, notarization, push, and publication remain out of scope.
- Standard valid fixtures and deterministic screenshot-equivalent E2E record zero preflight
  failures. The user explicitly excluded a live Gemini request from CP50 verification; live-provider
  telemetry remains post-checkpoint operational evidence rather than a closure gate. If future
  hands-on use shows a repeated `tool + code + paths` signature or a second retry after refresh, a
  separate circuit-breaker decision must be reconsidered.

### Local evidence

- Focused contract, mutation, session, worker/event, prompt, Renderer, and compatibility suites
  passed, including all-tool Main/preflight fixtures, contract-v1-v8 replay, section/image/outline
  regressions, safe diagnostic projection, and Pi-local error-result continuation.
- `pnpm check:fast` passed. `pnpm check:electron` passed 179 test files / 931 tests with three skips
  and its production build.
- A fresh build preceded the unpacked Electron suite; all 39 scenarios passed. The deterministic
  `agent.cp50-scope-and-preflight` scenario recorded zero preflight failures, exactly the expected
  contract-v8 Brief/outline/check calls, and no `submit_section_change` call.
- `pnpm check:package` passed the Electron 43.1.0 / ABI 148 native inventory, all recovery fixture
  checks, 12 packaged smoke scenarios, and all 27 packaged E2E scenarios with no flaky, skipped, or
  failed scenario. The no-Team-ID gate produced structurally verified local DMG and ZIP artifacts;
  it did not sign, notarize, publish, push, or run hosted CI.
- The user excluded a real Gemini request from this checkpoint's test plan. CP50 therefore closes
  on provider-neutral deterministic and packaged evidence; no model fallback or external request
  was performed.

### Explicit exclusions and sequencing

Checkpoint 50 keeps exactly the existing 20 model-visible tool names. It adds no generic edit tool,
alias, provider/model-specific prompt, automatic model fallback, relaxed optimistic concurrency,
generalized retry circuit breaker, migration, table, IPC authority, dependency, worker role,
durable job, or background Agent. A circuit breaker requires a separate protocol decision only if
post-fix evidence still shows repeated Pi-local preparation loops.

Checkpoint 49 is independently committed and no longer overlaps this work. Checkpoint 50 authorizes
ADR/architecture amendments, product code, tests, and the specified local package gate. Commit,
push, hosted CI, signing, notarization, publication, and release remain unauthorized.

## ADR 043 Refinement: Write Auto And YOLO Approval Semantics

### User outcome

- `manual` is unchanged: every proposal pauses for review.
- The middle mode is presented as **Write Auto** and applies every section, outline, and image
  proposal automatically, with no touched-block, character-volume, block-structure, or
  outline-operation limits. Brief and Writing Rules (`brief_update`) proposals still pause.
- `yolo` keeps its name and applies every proposal kind automatically, including Brief/Writing
  Rules changes.

### Scope

- `MainAgentTools.shouldAutoApprove` reduced to the three mode rules; the per-mode ceilings and
  the section-operation policy helper are removed.
- Persisted values (`manual`, `section_auto`, `yolo`), CHECK constraints, run snapshots, and IPC
  contracts are unchanged; no migration. Write Auto is the presentation name of `section_auto`.
- Composer/settings labels and menu descriptions updated; the focused E2E approval-menu
  expectations updated to match.

### Local evidence

- New `src/main/agent/tools-approval-policy.test.ts` covers the full mode-by-kind matrix,
  including Brief/Writing Rules remaining manual in Write Auto and auto-applying in YOLO.
- The session-service approval matrix cases were updated to the new semantics; both focused
  suites passed (67 tests).

### Explicit exclusions

No migration, dependency, provider, worker, durable job, package, commit, push, hosted CI,
signing, notarization, publication, or release action was authorized or performed.

## ADR 044 Refinement: Live Approval Mode Reads At Proposal Time

### User outcome

- The approval mode can be switched at any time — during an active run and while a proposal
  awaits review — from the composer picker or the session details pane.
- The auto-approve/review decision for each proposal reads the session's current mode at the
  moment the proposal is produced; the run-start snapshot no longer drives decisions.
- An already-paused proposal still requires a manual review action; mode changes apply to the
  next proposal.

### Scope

- `setApprovalMode` drops the active-run and pending-review refusals; the compatibility check
  remains.
- `#handleToolRequest` reads the live session mode via `#sessionApprovalMode` at proposal
  decision time and logs that mode on `agent.approval.auto_started`.
- `agent_runs.approval_mode` keeps recording the run-start mode as audit history.
- The Renderer picker and handler stay enabled during runs and review pauses (still disabled for
  archived sessions and in-flight writes).

### Local evidence

- New session-service tests cover a mid-run mode change being honored at proposal decision time
  and a mode change succeeding while a proposal awaits review; the focused session and policy
  suites passed (69 tests).

### Explicit exclusions

No migration, dependency, provider, worker, durable job, package, commit, push, hosted CI,
signing, notarization, publication, or release action was authorized or performed.

## Checkpoint 51: Pi Active Tool-Loop Context Recovery

Decision: accepted ADR 046; implementation and authorized delivery complete.

### User outcome

- A long editing request keeps its newest readable section body and concurrency identifiers in the
  next model call instead of replacing them with an unusable projection.
- If one read is too large, WriteLLM silently asks the Agent to read one smaller range once. The
  Agent does not tell the user to refresh, claim that the manuscript is missing, or guess omitted
  hashes.
- Only final exhaustion is visible: earlier confirmed changes remain, untouched content was not
  force-edited, and the user is advised to continue one section or smaller range at a time.

### Scope and implementation

- [x] Accept ADR 046 and preserve the current user request plus atomic assistant/tool-result
  batches in the Pi provider-facing context.
- [x] Retain the newest fitting read batch in full; project only older completed reads through a
  typed `historical_projection` with no mutation authority; never project mutation/effect results.
- [x] Add one run-local `active_batch_retry` path for a smaller sequential read and terminate a
  second oversized batch as `tool_batch_context_exhausted` before another provider call.
- [x] Update Agent policy for sequential body consumption, single retry, and truthful handling of
  projections without editor-refresh or manuscript-loss claims.
- [x] Propagate the terminal code through the existing Worker/Main contract and render an
  actionable failure detail only on final exhaustion; successful recovery remains log-only.
- [x] Preserve the full transcript, durable events, checkpoint markers, registered tools, IPC
  surface, database schema, and process boundaries.

### Acceptance gate

- [x] Focused unit and worker tests cover atomic pairing, current-user anchoring, newest-batch
  retention, historical privacy, parallel results, mutation exclusion, one successful smaller-read
  recovery, terminal exhaustion, and no mutation replay.
- [x] Main/Renderer tests cover typed error propagation, no provider-overflow restart, the exact
  final user guidance, and absence of successful-recovery timeline noise.
- [x] `pnpm check:fast`, `pnpm check:electron`, `pnpm check:e2e`, and `pnpm check:package` pass,
  including the long-document Real-Electron regression.
- [x] The delivery branch was created from `origin/main`; final delivery requires a fresh remote
  comparison, one intentional commit, a fast-forward of local `main`, and a non-force push.

### Local evidence

- Seven focused test files passed 120 tests. The prompt-budget review passed its two focused tests
  after accepting the intentional policy-size change from 10,421 to 10,963 characters.
- `pnpm check:fast` passed. `pnpm check:electron` passed 180 files and 956 tests with the three
  benchmark suites skipped, followed by the production build.
- The focused long-document Real-Electron scenario proved RQ1/RQ2 historical projection while RQ3
  body text, `blockId`, `blockHash`, and `revisionId` remained complete. The full E2E gate passed
  40/40 scenarios with no flaky, skipped, or failed result.
- The recovery verifier passed all 25 fixtures from 23 sources. `pnpm check:package` verified
  Electron 43.1.0 / ABI 148, the no-Team-ID macOS arm64 App, all 12 packaged smoke scenarios, and
  28/28 packaged E2E scenarios including the long-document regression.
- The accepted local environment reports Node 26.7.0 against the repository's Node 24 engine
  range; pnpm 11.17.0, Electron ABI/native checks, every required gate, and the app build completed.

### Explicit exclusions

Checkpoint 51 adds no model-visible tool, IPC method, database migration, dependency, durable job,
worker role, hosted CI, signed release, notarization, or publication flow. The package gate's local
DMG/ZIP inspection artifacts are ignored and are not committed or published. Delivery is one
intentional commit fast-forwarded directly to `origin/main`; force push is prohibited.

## Checkpoint 52: Knowledge Citation Coverage Checks

Decision: accepted ADR 047; implementation complete.

### User outcome

- A dedicated Checks workspace shows what share of the currently indexed Knowledge articles is
  cited by the current manuscript.
- Coverage stays article-grained: repeated citations contribute an occurrence count, while block,
  page, and section detail is not exposed.
- Duplicate source titles and citation titles without an indexed source remain explicit Needs
  attention results instead of inflating coverage or guessing an identity.

### Scope and implementation

- [x] Accept ADR 047 and fix the active-current-index denominator, canonical title matching,
  ambiguity, unmatched citation, null-percentage, bounded projection, and read-only UI semantics.
- [x] Add strict shared contracts, a safe current-index source snapshot, the Main-owned coverage
  service, project-session IPC, Preload projection, cancellation, and structured lifecycle logs.
- [x] Add the independent Checks workspace, source ledger, summary, progress, filters,
  search, pagination, refresh, and explicit preparing/unavailable/empty/stale states.
- [x] Flush the active editor before navigation and refresh coverage after section mutations or
  index-generation lifecycle changes.
- [x] Add focused domain, index, IPC, Preload, Renderer, and Real-Electron regression coverage.
- [x] Pass the authorized static, Electron, fresh-build E2E, Impeccable, and diff gates and record
  exact local evidence.

### Acceptance gate

- Unique, repeated, Unicode-normalized, case-distinct, page-qualified, ambiguous, and unmatched
  citation fixtures produce the exact article counts and null zero-denominator result.
- Only the active generation matching the latest source fingerprint contributes articles; stale,
  preparing, unavailable, cancelled, and mid-request source changes fail closed without private
  path projection.
- Pagination, filters, title query, snapshot-bound cursor restart, sender authorization, session
  revocation, original-error logging, and response bounds are covered.
- Renderer coverage includes rail navigation, editor-flush failure, summary/progress, every filter,
  load-more, refresh, keyboard access, and all non-ready/empty states.
- Focused tests pass before `pnpm check:fast` and `pnpm check:electron`; a fresh build precedes
  `pnpm check:e2e`. The scoped Impeccable detector and `git diff --check` pass. Because the work
  adds no worker/native/package boundary, `check:package` remains out of scope.

### Local evidence (2026-08-18)

- Focused coverage/index verification passed 16 tests; focused Knowledge IPC verification passed
  7 tests. Fixtures cover NFC/trim, case sensitivity, page suffixes, repeated occurrences,
  ambiguity, unmatched citations, zero denominator, filters/query, pagination-bound snapshots,
  active-generation changes, safe projection, explicit index states, cancellation, strict bounds,
  sender authorization, and session revocation.
- `pnpm check:fast` passed. The final `pnpm check:electron` passed 181 test files / 965 tests with
  three intentionally skipped benchmark tests, followed by a successful production build.
- A fresh `pnpm check:e2e` passed all 41/41 scenarios with no flaky, skipped, or failed scenario.
  `knowledge.citation-coverage` exercised four indexed sources, cited/uncited/ambiguous/unmatched
  results, title filters, editor flush, and the updated snapshot after another manuscript edit.
  The existing section-conflict scenario additionally proved that a failed flush does not open
  Checks.
- The completed-page screenshot was inspected at the real Electron desktop viewport. The scoped
  Impeccable detector returned no findings, and final Biome plus `git diff --check` passed. Local
  Node 26.7.0 remains outside the repository's Node 24 engine range; pinned pnpm 11.17.0,
  Electron 43.1.0 / ABI 148, native preparation, tests, and builds all completed.
- No migration, package gate, commit, push, hosted CI, signing, notarization, release, or
  publication action ran.

### Explicit exclusions

Checkpoint 52 adds no database migration, stored coverage history, section scope, manual ignore,
source-opening action, model-visible Agent tool, retrieval exclusion filter, dependency, worker
protocol, durable job, package/release, hosted CI, commit, push, signing, notarization, or
publication. The existing `check_draft.unused_resources` semantics remain unchanged.

## Checkpoint 53: Existing Image Cross-Section Relocation

Decision: accepted ADR 048; implementation complete.

### User outcome

- An Agent can relocate an existing manuscript image into another section without generating new
  image bytes or asking the user to recreate the figure manually.
- Destination insertion always precedes source deletion. A failure may leave a visible duplicate
  for recovery but never removes the only copy.
- Same-section movement remains `moveBlocks`; generic cross-section blocks remain unsupported.

### Scope and implementation

- [x] Accept ADR 048 and preserve the twenty-tool, Main-authoritative, single-section proposal
  boundary with one explicit existing-image source-copy exception.
- [x] Add the model-only `insertExistingImage` operation, exact current-run source read and active
  asset/annotation validation, authoritative image copying, new destination block identity, stable
  figure identity, and ordinary `insertBlocks` normalization.
- [x] Add application policy for insert-before-delete sequencing and terminal source-removal
  conflicts; correct cross-section `moveBlocks` recovery without changing ordinary stale recovery.
- [x] Add focused contract, normalization, proposal, approval-policy, and failure-path coverage.
- [x] Add the SPACE image Main-tool/database regression and pass the authorized verification gates.

### Acceptance gate

- Root and anchored destination insertion preserve active asset, caption, alt text, presentation,
  and `figureId`, mint a new block ID, and never call the image provider.
- Non-image, same-section, missing, stale, unread, inactive-asset, annotated, and invalid-anchor
  inputs fail closed before proposal persistence.
- Manual mode stops on a pending insertion. Write Auto and YOLO may remove the source only after an
  applied or satisfied insertion, using the original source hash; source conflict is not retried
  with refreshed authority.
- A cross-section `moveBlocks` target receives an actionable `fix_arguments` error naming
  `insertExistingImage`; ordinary missing and stale same-section blocks keep `read_section`
  recovery.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, a fresh `pnpm check:e2e`, and
  `git diff --check` pass. No package gate is required because no native, worker, or packaged
  resource boundary changes.

### Local evidence (2026-08-18)

- Five focused contract, normalization, proposal, policy, and tool-envelope suites passed 54 tests;
  the explicit prompt-budget baseline suite passed 2 more. They cover root/anchored insertion,
  metadata and `figureId` retention, new block identity, twenty-tool/8 KiB bounds, forged input,
  same-section/non-image/nested/missing/stale/unread/cross-project source cases, target anchors,
  inactive assets, active annotations, and cross-section `moveBlocks` recovery.
- The SPACE fixture used a registered upload asset and real Main proposal/database services. A
  pending destination proposal left the source untouched; approval copied the image after the
  target paragraph; exact source removal then left one target image and zero image model requests.
  A changed source hash left both copies and persisted no removal proposal.
- `pnpm check:fast` passed. The final `pnpm check:electron` passed 182 test files / 980 tests with
  three intentionally skipped benchmark tests, followed by a successful production build. The
  deliberate policy growth updated the reviewed prompt baseline from 10,963 to 11,667 bytes and
  remains below the 16 KiB policy limit.
- A fresh `pnpm check:e2e` build passed all 41/41 Real-Electron scenarios with no flaky, skipped,
  or failed scenario. Final Biome and `git diff --check` passed. Local Node 26.7.0 remains outside
  the repository's Node 24 engine range; pinned pnpm 11.17.0 and Electron 43.1.0 / ABI 148 completed
  the authorized gates.
- No package gate, migration, provider call, commit, push, hosted CI, signing, notarization,
  release, or publication action ran.

### Explicit exclusions

Checkpoint 53 adds no migration, new tool name, proposal kind, IPC, Renderer surface, provider
call, dependency, worker role, durable relocation state, generic block copy, atomic multi-section
transaction, package/release, hosted CI, commit, push, signing, notarization, or publication.

## Checkpoint 54: Harness-Style Writing Context Compaction

Decision: accepted ADR 049; implementation complete.

### User outcome

- Long requests keep requirements from their middle instead of summarizing only a 1,024-character
  head/tail projection.
- A compacted conversation resumes from current authoritative writing context, a writing-specific
  bounded handoff, and up to 20,000 tokens of recent complete raw turns.
- Handoff constraints can guide continuity but cannot authorize a manuscript change or replace a
  current project/evidence read.
- A compaction failure never silently drops an uncheckpointed user requirement before provider
  work.

### Scope and implementation

- [x] Accept ADR 049 and amend ADR 019's target, manual, handoff-semantics, and fallback decisions.
- [x] Add adaptive 32k post-compaction, 12k checkpoint, and 20k recent-tail budgets; preserve
  complete raw turns for both automatic and manual compaction.
- [x] Pass full completed user/assistant text to the compaction model while retaining bounded safe
  projections for tools, credentials, private paths, and source bodies.
- [x] Add the writing-specific summary contract, checkpoint payload v3, legacy/v2 replay, and
  bounded conversation-memory usage policy.
- [x] Reject oversized indivisible history and unsafe summary-failure omission before provider
  activity without replaying tools, proposals, mutations, or effects.
- [x] Add focused budget, projection, prompt, session, compatibility, and failure coverage; pass
  the static, Electron, fresh E2E, and diff gates and record exact evidence.

### Acceptance gate

- A requirement in the middle of a long Chinese or English user message reaches compaction
  verbatim; full terminal assistant text also reaches it, while large tool bodies, credentials,
  and private paths do not.
- At the maximum, post-compaction history contains no more than 12k checkpoint tokens and reserves
  up to 20k for recent complete turns. Smaller contexts scale at 37.5/62.5 percent without
  truncating the current request or a retained turn.
- Automatic and manual compaction produce payload-v3 checkpoints. Legacy/v2 events remain readable
  with no conversation authority; v3 loads as bounded conversation memory beneath current policy,
  Brief, Writing Rules, and current user intent.
- Repeated compaction carries active requirements, exclusions, terminology, decisions, evidence
  gaps, and unfinished work while marking overridden directions as superseded.
- Automatic failure continues only when no uncheckpointed user turn would be omitted. Oversized
  indivisible history and unsafe fallback terminate before a provider call with an actionable,
  retryable error and no side-effect replay.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, a fresh `pnpm check:e2e`, and
  `git diff --check` pass. No package gate is required because no native, worker-entrypoint, or
  packaged-resource boundary changes.

### Local evidence

- The focused contract/planner/projection/prompt/session/Renderer suite passed 8 files / 107 tests.
  It covers long Chinese and English request middles, long terminal assistant text, token-first
  source selection, 240-event paging, adaptive small/large budgets, v1/v2/v3 compatibility,
  conversation-memory authority, rolling handoff continuity, unsafe-fallback rejection, and a
  newest 20k-plus raw turn borrowing unused checkpoint budget without truncation.
- `pnpm check:fast` passed Biome over 601 files plus Node and Renderer typechecks. The deliberate
  policy addition updated the reviewed fixed-prompt baseline to 12,148 bytes and remains under the
  16 KiB policy ceiling.
- `pnpm check:electron` passed 182 test files / 984 tests with three intentionally skipped
  benchmark tests, followed by a successful production build.
- A fresh `pnpm check:e2e` build passed all 41/41 Real-Electron scenarios with no flaky, skipped,
  or failed scenario. Final `git diff --check` passed.
- Local Node 26.7.0 remains outside the repository's Node 24 engine range; pinned pnpm 11.17.0 and
  Electron 43.1.0 / ABI 148 completed the authorized gates. No package/release, hosted CI,
  provider, commit, push, signing, notarization, or publication action ran.

### Explicit exclusions

Checkpoint 54 adds no editable memory/rule ledger, compaction table, database migration, durable
job, model-visible tool, IPC method, Renderer setting, provider-specific prompt, worker role,
dependency, package/release action, hosted CI, commit, push, signing, notarization, publication, or
cross-conversation memory.

## Checkpoint 55: Agent Composer Context Usage Indicator

Decision: accepted ADR 050; implementation complete.

### User outcome

- The latest trustworthy context-window usage is visible beside the model/Thinking summary during
  ordinary writing instead of being available only in Agent Details.
- Hover or keyboard focus reveals used and remaining percentages plus compact token counts.
- A new conversation or a model switch never presents unknown or stale-model usage as zero or as
  capacity for the newly selected model.

### Scope and implementation

- [x] Accept ADR 050 and preserve the four-action composer hierarchy, neutral visual language,
  run-specific model limits, and existing Agent Details surface.
- [x] Derive one latest valid assistant usage snapshot paired with its originating run, and expose
  it only while that run matches the conversation's current model selection.
- [x] Add the fixed-width accessible circular indicator, focus/hover tooltip, compact formatting,
  estimated marker, and desktop-panel layout containment.
- [x] Add focused Renderer/view-model and Real-Electron coverage; pass the static, Electron, UI,
  Impeccable, and diff gates and record exact evidence.

### Acceptance gate

- Before the first trustworthy model response, after an unmatched model switch, or when the run is
  unavailable, the ring is absent rather than empty or zero.
- Valid exact and estimated usage use the originating run's immutable context window; percentages
  clamp to 0-100, the tooltip reports whole used/left percentages and compact token counts, and
  Agent Details consumes the same snapshot.
- The indicator is keyboard-focusable with progress semantics, has no click action or warning
  color, and appears immediately before the model trigger without overlapping Approval or Send in
  the configured desktop Agent panel.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, an applicable fresh-build Real-Electron
  gate, one bounded screenshot review, the scoped Impeccable detector, and `git diff --check` pass.
  No package gate is required because no native, worker, or packaged-resource boundary changes.

### Explicit exclusions

Checkpoint 55 adds no IPC method, database migration, persisted usage state, provider call,
worker change, model capability, threshold-warning policy, Details navigation shortcut,
dependency, package/release action, hosted CI, commit, push, signing, notarization, publication, or
change to the existing context-compaction policy.

### Local evidence

- The focused context-indicator and Agent view-model suites passed 2 files / 27 tests. They cover
  exact and estimated labels, compact counts, clamped progress, ARIA/focus semantics, unknown
  hiding, run correlation, model/preset mismatch, originating-run limits, and provider
  input-plus-cache fallback.
- `pnpm check:fast` passed Biome over 603 files plus Node and Renderer typechecks.
  `pnpm check:electron` passed 183 test files / 990 tests with three intentionally skipped
  benchmark files/tests, followed by a successful production build.
- The fresh focused Real-Electron `agent.grounded-proposal-workflow` scenario passed. It verifies
  pre-response absence, 45-percent progress semantics, keyboard focus, the exact tooltip, and
  non-overlap among Approval, ring, model, and Send in the configured desktop panel.
- Default and focused-tooltip screenshots were inspected. The scoped Impeccable detector returned
  no findings, the independent Impeccable finish reviewer returned `ship` with no material
  findings, and `git diff --check` passed.
- Local Node 26.7.0 remains outside the repository's Node 24 engine range; pinned pnpm 11.17.0 and
  Electron 43.1.0 / ABI 148 completed the authorized gates. No package/release, hosted CI,
  provider, commit, push, signing, notarization, or publication action ran.

## Checkpoint 56: Agent Plan Bottom Progress Capsule

Decision: user-approved plan; implementation complete. No new ADR is required because the
refinement preserves ADR 025's task identity, state machine, persistence, and Renderer authority.

### User outcome

- The conversation no longer loses a large permanent region to the full writing-task plan and
  task change set.
- A centered capsule above the composer reports the current step ordinal and opens the complete
  plan on click, Enter, or Space; terminal plans remain inspectable as `Plan complete`.
- The existing task change set remains fully usable inside the same detail surface without
  becoming a second review flow.

### Scope and implementation

- [x] Replace the fixed task and change-set blocks with one bottom-docked shadcn Popover trigger.
- [x] Project current-step, terminal, attention, review, blocked, failed, skipped, and disagreement
  states through semantic Lucide icons and accessible text without changing shared contracts.
- [x] Move the existing change-set Collapsible into the Popover, preserve batch actions and the
  reject Dialog, and close the Popover before navigating to a timeline proposal.
- [x] Add focused summary and Real-Electron coverage for ordinal semantics, keyboard interaction,
  focus restoration, nested review, restart recovery, and proposal navigation.
- [x] Pass the static, Electron, fresh-build E2E, screenshot, Impeccable, and diff gates and record
  exact local evidence.

### Acceptance gate

- The default Agent layout contains no permanently expanded plan or task change set above the
  message timeline; the capsule occupies one non-overlapping row above the composer.
- `Step N / Total` derives N from the current step's ordered position rather than completed count.
  A terminal task remains available as `Plan complete`; a non-terminal task without a current step
  truthfully reports that the plan needs attention.
- The Popover supports click, Enter, Space, Escape, focus restoration, session/task replacement,
  archived read-only behavior, bounded scrolling, and the configured desktop Agent panel.
- Plan revision, Resume, change-set expansion, batch Reject, and exact proposal navigation retain
  their existing behavior and authority.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, a fresh focused Real-Electron run,
  screenshot inspection, scoped Impeccable, independent finish review, and `git diff --check`
  pass. No package gate is required because no native, worker, or packaged-resource boundary
  changes.

### Local evidence

- The focused Agent panel suite passed 11/11 tests. The new view-model regression proves that
  `Step N / Total` uses the `currentStepId` position even when `completedCount` differs, and covers
  terminal and missing-current-step labels. `pnpm check:fast` passed Biome over 603 files plus Node
  and Renderer typechecks.
- The final `pnpm check:electron` passed 183 test files / 991 tests with three intentionally skipped
  benchmark files/tests, followed by a successful production build. The fresh focused
  Real-Electron `agent.writing-task-identity` scenario passed against that build.
- The Real-Electron scenario covers Enter, Space, Escape, trigger focus restoration, accessible
  dialog naming, plan editing, Resume, change-set expansion, nested Reject Dialog, batch result,
  post-close proposal focus, archive/restore, restart recovery, and historical change-set access.
- Collapsed and open desktop Agent-panel screenshots were inspected. The capsule remains centered
  in its own row, the Popover stays within panel bounds, internal content wraps or scrolls, and
  neither the message timeline nor composer is covered.
- The scoped Impeccable detector returned no findings. The independent finish reviewer identified
  close-autofocus and dialog-naming gaps; both were fixed with regression assertions, and the
  bounded re-review returned `ready` with no unresolved risk. Final formatting and
  `git diff --check` passed.
- Local Node 26.7.0 remains outside the repository's Node 24 engine range; pinned pnpm 11.17.0 and
  Electron 43.1.0 / ABI 148 completed the authorized gates. No package/release, hosted CI,
  provider, migration, dependency, commit, push, signing, notarization, or publication action ran.

### Explicit exclusions

Checkpoint 56 adds no IPC method, database migration, shared contract, Agent tool, provider call,
worker change, dependency, new review authority, package/release action, hosted CI, commit, push,
signing, notarization, publication, or application-wide visual redesign.

## Checkpoint 57: Fixed Multi-Provider Image Generation

Decision: accepted ADR 051; implementation complete.

### User outcome

- Image generation can use a saved Google Gemini, OpenAI, or xAI configuration without discarding
  either of the other two credentials.
- One source is explicitly active at a time, and a failure or removal never silently spends money
  through another provider.
- Existing Agent image generation, proposals, assets, and candidate history continue to work with
  accurate provider/model lineage.

### Scope and implementation

- [x] Add the strict three-source/model catalog, active-source snapshot and IPC, independent
  configuration IDs and credential bindings, and the forward legacy-Gemini app.sqlite migration.
- [x] Add exact-pinned `openai@7.5.0`; implement OpenAI Image API and xAI-compatible SDK generation
  plus non-generating model probes in the existing background-worker with retries disabled.
- [x] Preserve bounded image/error projections, request cancellation, Main MIME/byte/dimension/hash
  validation, nullable OpenAI auto effective size, and existing model-request/asset lineage.
- [x] Replace the singleton Image API settings workspace with three fixed source workspaces and one
  global active-source selection; keep all Agent tool descriptions provider-neutral.
- [x] Add focused contract, migration/security, worker, Main/IPC, Renderer, and Real-Electron
  coverage and pass every authorized gate.

### Acceptance gate

- Fixed provider/model schemas reject custom endpoints and mismatches; snapshots never expose
  credentials, and save/test/remove operations identify the exact image source.
- Legacy Gemini configuration and ciphertext migrate without loss; credentials remain independent;
  switching preserves them; removing the active source clears selection and generation fails
  closed.
- OpenAI and xAI requests serialize exactly the approved fields, use one request with SDK retries
  disabled, honor cancellation/timeout, and reject missing, malformed, or oversized base64.
- Main uses the source captured when a request starts, records exact provider/model lineage, and
  validates every returned asset before publication.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, complete Real-Electron settings and
  generation coverage, `pnpm check:package`, and `git diff --check` pass. Live billable OpenAI/xAI
  smoke is excluded unless the user separately supplies keys and authorizes one request each.

### Local evidence

- Focused contract, migration/repository, ProviderService, IPC, worker serialization/probe,
  Main model-request/asset, and Renderer suites passed 10 files / 83 tests. They cover the fixed
  provider/model directory, endpoint rejection, nullable OpenAI auto size, exact OpenAI/xAI SDK
  request bodies, bounded base64/MIME/error handling, cancellation, non-generating model probes,
  legacy Gemini migration, independent credentials, explicit switching, fail-closed removal, and
  exact provider/model lineage.
- `pnpm check:fast` passed. The final `pnpm check:electron` passed 184 files / 1009 tests with three
  intentional benchmark skips, then completed the production build. The macOS
  `task_name_for_pid` diagnostics were non-fatal and Vitest produced its normal passing summary.
- The updated focused Real-Electron settings lifecycle passed 1/1, then the fresh full suite passed
  41/41 with no flaky, skipped, or failed scenario. It saves all three encrypted credentials,
  switches the active source, proves removing the active OpenAI source clears selection without
  erasing Gemini/xAI, verifies snapshots omit all three secrets, activates xAI, and reopens with
  the same state. The successful generation path is covered without billing by the worker/Main
  HTTP and asset fixtures; no product test seam or custom endpoint was added.
- The recovery manifest passed all 25 cases from 23 sources after refreshing the three intentionally
  changed test-source hashes. `pnpm check:package` passed the no-Team-ID macOS arm64 unpacked app,
  native/ASAR/resource inventory, app.sqlite v9, all 12 packaged smoke scenarios, all 28 packaged
  Real-Electron scenarios, and DMG/ZIP creation plus structural hashes.
- `git diff --check` passed. Local Node 26.7.0 remains outside the repository's Node 24 engine
  range; pinned pnpm 11.17.0 and Electron 43.1.0 / ABI 148 completed every authorized gate. No live
  OpenAI/xAI image request, hosted CI, commit, push, signing identity, notarization, release,
  promotion, or publication action ran.

### Explicit exclusions

No Responses API image generation, image editing, masks, reference images, transparent output,
multi-image batches, 4K, automatic fallback, proxy/custom endpoints, provider-specific worker,
generic image plugin framework, hosted CI, commit, push, signing, notarization, release, or
publication action is authorized.

## Checkpoint 58: Independent Markdown Preview Workspace

Decision: user-approved plan; implementation complete. No new ADR is required because the
refinement preserves the accepted workspace shell, Markdown conversion boundary, Renderer
sandbox, and project-session capability authority.

### User outcome

- Preview is a first-class global-sidebar destination immediately after Manuscript rather than an
  action hidden inside the Outline editor.
- The main content region becomes a calm, readable Markdown surface with deliberate hierarchy,
  measure, and vertical rhythm in light and dark desktop states.
- The preview remains truthful to the existing lossy Markdown export projection and explicitly
  reports formatting differences without inventing Brief or References content.

### Scope and implementation

- [x] Add the Preview rail destination and independent shadcn sidebar workspace; flush the active
  editor before leaving Manuscript, preserve section context, and remove the old Dialog entry.
- [x] Render the existing `manuscriptToMarkdown` projection through the current safe Markdown,
  project-asset, Mermaid, and KaTeX boundaries.
- [x] Add the project-owned shadcn Typeset stylesheet and a 16px / 1.75 / 1.35em manuscript preset
  inside an approximately 70ch reading measure.
- [x] Add focused Renderer and Real-Electron coverage, run the authorized static/Electron/E2E/UI/
  Impeccable/diff gates, and record exact local evidence.

### Acceptance gate

- Outline contains no preview action or preview callback. Preview rail navigation never opens a
  Dialog, exposes an active destination in every workspace, and a failed editor flush leaves the
  author in Manuscript.
- The workspace uses the established rail, contextual sidebar, and `SidebarInset`; loading, error,
  empty, retry, refresh, keyboard-focus, and return-to-Manuscript paths remain usable.
- GFM headings, paragraphs, lists, quotes, code, tables, task lists, images, Mermaid, and math render
  without horizontal page overflow. Only allowed HTTPS links and session-resolved logical project
  assets become active URLs.
- The article contains the existing Markdown projection only: no Brief title/description,
  objective, or References appendix is injected. Any conversion losses produce one concise count.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, fresh affected Real-Electron coverage,
  bounded light/dark desktop screenshot inspection, scoped Impeccable, and
  `git diff --check` pass. No package gate is required for this Renderer-only change.

### Local evidence (2026-08-19)

- The new three-test Renderer suite passed headings, paragraphs, lists, quotes, GFM table scroll,
  code, KaTeX, Mermaid interception, Typeset classes, loss counting, Brief/objective/References
  exclusion, HTTPS filtering, and strict `writellm-asset:` acceptance. The existing conversion and
  rich-media tests remained green.
- The focused Real-Electron workspace, conflict, and rich-media scenarios passed. They prove the
  Outline action is absent, Preview is an independent active rail destination with no Dialog,
  an unsaved body flushes before navigation, a stale-save conflict stays in Manuscript, section
  order/body survives projection, objectives stay private, the project-asset capability resolves,
  sanitized Mermaid, KaTeX, captions, and return-to-section context remain intact in the desktop
  layout.
- `pnpm check:fast` passed. `pnpm check:electron` passed 185 test files / 1012 tests with three
  intentional benchmark skips and completed the production build. A fresh full
  `pnpm test:e2e` passed 41/41 scenarios with no flaky, skipped, or failed scenario.
- Light desktop and dark rich-media screenshots were inspected. The
  scoped Impeccable detector returned no findings, final Biome passed, and `git diff --check`
  passed. Local Node 26.7.0 remains outside the repository's Node 24 engine range; pinned pnpm
  11.17.0 and Electron 43.1.0 / ABI 148 completed every authorized gate.
- No package/release gate, migration, dependency install, billable provider call, hosted CI,
  commit, push, signing, notarization, release, promotion, or publication ran.

Packaging addendum: after Checkpoint 58 completion, the user separately authorized one local
no-identity macOS arm64 unpacked App build for hands-on use. `pnpm build:unpack` passed the
Electron 43.1.0 / ABI 148 native and ASAR/resource inventory, all 12 packaged runtime smoke
scenarios, and all 28 packaged Real-Electron scenarios with no flaky, skipped, or failed result.
It produced `dist/macos-arm64/mac-arm64/WriteLLM.app`; no DMG, ZIP, signing identity discovery,
notarization, hosted CI, commit, push, release, promotion, or publication was performed.

### Explicit exclusions

Checkpoint 58 adds no IPC method, shared contract, database migration, persisted preview state,
worker or provider change, dependency, native manuscript/Markdown mode switch, package/release
action, hosted CI, commit, push, signing, notarization, or publication.

## Checkpoint 59: Google Cloud Vertex AI Nano Banana Image Source

Decision: accepted ADR 052; implementation complete.

### User outcome

- Google Vertex AI is an independent image source beside Google Gemini / AI Studio.
- The user configures one Google Cloud Project ID and uses this computer's local Application
  Default Credentials, then explicitly activates Vertex without deleting or overwriting any other source.
- Nano Banana, Nano Banana Pro, and Nano Banana 2 retain accurate provider/model lineage through the
  existing generation, asset, proposal, and Agent workflows.

### Scope and implementation

- [x] Add the strict `google-vertex` configuration and four-source catalog without a schema migration.
- [x] Add the fixed global Vertex SDK client with ADC, a non-generating probe, and one
  `generateContent` image request in the existing background worker.
- [x] Add the Vertex Project ID, fixed location, model, and local-ADC guidance settings surface.
- [x] Add focused contract, provider, worker, IPC, Renderer, and Real-Electron coverage and pass all
  authorized static, Electron, E2E, package, and diff gates.

### Acceptance gate

- Vertex accepts only a valid Project ID, `global`, and the three fixed Nano Banana model IDs;
  WriteLLM never accepts, transmits through IPC, or persists a Vertex API key or ADC token.
- Requests use only the official SDK's fixed global Vertex project endpoint and ADC authentication,
  one prompt, text-plus-image modalities, one inline PNG/JPEG image, and no application retry.
- Removing active Vertex clears selection without changing Gemini/OpenAI/xAI; failures never trigger
  another provider.
- Focused tests, `pnpm check:fast`, `pnpm check:electron`, fresh complete Real-Electron coverage,
  `pnpm check:package`, and `git diff --check` pass. No live billable request runs without separate
  local ADC and authorization.

### Local evidence

- Focused shared-contract, ProviderService, provider/auxiliary worker client, worker request, IPC,
  Renderer, and model-execution lineage suites passed 9 files / 83 tests. They cover the
  four-source order, strict Project ID/global/model directory, Vertex API-key rejection, omitted
  credential envelopes, ADC client initialization, non-generating `countTokens`, one image request,
  size mapping, cancellation, safe errors, inline-image validation, ambient activation/removal,
  and exact `google-vertex` provider/model lineage.
- `pnpm check:fast` passed. `pnpm check:electron` passed 185 files / 1026 tests with three
  intentional benchmark skips, then completed the production build. Electron's macOS
  `task_name_for_pid` diagnostics were non-fatal and Vitest produced its normal passing summary.
- The first complete Real-Electron run passed 40/41 and exposed one overly strict test expectation
  for the visible model label; after correcting that assertion, the fresh complete suite passed
  41/41 with no flaky, skipped, or failed scenario. It saves Vertex without a credential field,
  activates and removes it without changing Gemini, resaves it, and verifies restart recovery.
- All 25 recovery fixtures from 23 sources passed after refreshing the two intentionally changed
  source hashes. `pnpm check:package` passed the no-Team-ID macOS arm64 App, native/ASAR/resource
  inventory, app.sqlite v9, all 12 packaged smoke scenarios, all 28 packaged E2E scenarios, and
  DMG/ZIP creation plus structural hashes.
- `git diff --check` passed. Local Node 26.7.0 remains outside the repository's Node 24 engine
  range; pinned pnpm 11.17.0 and Electron 43.1.0 / ABI 148 completed every authorized gate. No live
  ADC probe, billable image request, hosted CI, commit, push, signing identity, notarization,
  release, promotion, or publication action ran.

### Hands-on repair evidence

- The first live trial returned a Vertex candidate and one inline image through local ADC, then
  failed inside the worker with `RangeError: Maximum call stack size exceeded` while a recursive
  regular expression validated the multi-megabyte Base64 payload. No 401, 403, model, quota, or
  other provider error occurred.
- The validator now performs one bounded linear scan over the existing standard Base64 alphabet,
  four-character length, terminal padding, and 28,000,000-character constraints. It does not
  allocate decoded image bytes or alter the later MIME/magic/Main publication checks.
- The focused worker suite passed 32/32, including an 8,000,000-character inline PNG regression
  that reproduced the previous stack failure. `pnpm check:fast` passed; `pnpm check:electron`
  passed 185 files / 1027 tests with three intentional benchmark skips plus the production build;
  fresh complete Real-Electron E2E passed 41/41.
- All 25 recovery fixtures from 23 sources passed. The no-Team-ID macOS arm64 package gate passed
  all 12 packaged smoke and 28/28 packaged E2E scenarios, then rebuilt the App, DMG, and ZIP. The
  DMG SHA-256 is `7ce00678c4318a5fd8cd81e2190feb9dec9612620e5da611c9523d1ce2179ce4`;
  the ZIP SHA-256 is `6aae715d4a8e7ca2e63a80f416cee7d93ec1e02da8f587130eb2301d7b9359be`.
- The replacement build used the current dirty worktree and did not run a second billable Vertex
  image request. No commit, push, hosted CI, Apple identity signing, notarization, release,
  promotion, or publication ran.

### Explicit exclusions

No Imagen model, Express Mode, custom OAuth flow, service-account JSON import, custom location/endpoint/model,
image editing, reference image, multi-image batch, 4K, automatic fallback, provider-specific worker,
hosted CI, commit, push, signing, notarization, release, promotion, or publication is authorized.
