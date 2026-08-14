# Phase 12: Use And Fix

Status: Checkpoint 50 is complete under accepted ADR 042
Recorded: 2026-08-13

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

## Checkpoint 48: Agent Composer Progressive Disclosure

Decision: accepted ADR 038.

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
  approval labels, remove the shield icon, and prevent approval/model/Send overlap at narrow Agent
  panel widths.
- [x] Apply ADR 040 after hands-on use: replace the idle paper-plane-plus-text Send control with a
  primary circular upward-arrow button while preserving its accessible name and existing behavior.
- [x] Implement one shared Add/slash command catalog for context scope and Writing Skill, with
  keyboard navigation, IME-safe behavior, disabled states, and no hidden prompt mutation.
- [~] Add focused Renderer coverage, update affected Real-Electron expectations, run the smallest
  applicable static/Electron/UI/diff gates, and record exact evidence.

### Acceptance gate

The default idle composer has one visual row below the prompt and keeps Send dominant. A model with
reasoning displays the exact selected model name plus lower-case Thinking token; an unsupported
model exposes no fake effort choice. Model switching clamps through the existing Main authority.
Every approval label and description matches the current proposal policy. Add and `/` route to the
same context and Skill actions, Escape closes the slash menu, arrow/Enter selection works through
the shadcn Command primitive, and ordinary slash-containing prose is unaffected. Existing run,
queue/steer/stop, review, narrow-window, session-lock, and Details behavior remains intact.

The ADR 039 refinement additionally requires the collapsed and menu approval titles to read
`Manual`, `Section`, and `YOLO`; no approval icon is shown; descriptions remain behaviorally
accurate; and each footer control stays within its allocated box at the reported panel width.

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

Formal checkpoint closure remains pending only because ordinary `pnpm check:fast` also formats the
user-owned concurrent `.vscode/settings.json` edit and reports its multiline `cSpell.words` array.
That unrelated file was intentionally preserved. TypeScript, all code formatting/lint rules, full
Electron tests/build, focused E2E, UI inspection, and diff checks passed; no package or release gate
is required for this Renderer-only checkpoint.

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

The hands-on approval shorthand and responsive-width refinement is complete. Scoped Biome passed
the two changed Agent components and affected E2E file. Two focused Renderer files passed 11
tests, and `pnpm check:electron` passed 179 test files / 915 tests with the same three opt-in
benchmarks skipped before completing the production build. A fresh focused Real-Electron Agent
workflow passed with zero flaky, skipped, or failed scenarios; it asserted `Manual`, `Section`, and
`YOLO`, one disclosure icon only, the three truthful descriptions, and non-overlapping approval,
model, and Send bounds in the default 480px panel. Screenshot inspection confirmed the compact
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
states in the default 480px panel. The Impeccable detector returned no findings and the final diff
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

Decision: accepted ADR 041; implementation authorized.

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
usable at the narrowest supported Agent width, and disappears without leaving space when empty.
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
  Close click; one independent mobile-sidebar fixture failed only on the first attempt and passed on
  the second. Neither path exercises pending messages or the changed runtime protocol.
- An original-resolution Agent-panel screenshot with two queued rows showed no overlap; the list,
  Steer/Delete actions, composer controls, and circular Stop remained contained. The Impeccable
  detector reported `[]`, and `git diff --check` passed.
- No database migration, dependency, package/release gate, App artifact, commit, push, tag, signing,
  notarization, hosted CI, publication, or promotion action ran.

## Checkpoint 50: Agent Tool Contract Reliability And Scope Discipline

Decision: accepted ADR 042; implementation authorized after independent Checkpoint 49 closure.

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
