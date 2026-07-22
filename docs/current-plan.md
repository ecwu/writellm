# WriteLLM Current Plan

Status: Agent Harness Protocol v2 hardening is complete; Checkpoint 24 remains unstarted.
Recorded: 2026-07-22

## Completed scope

Phase 9 is complete. WriteLLM now has project-local durable Agent sessions, request-scoped runs, ordered events, four bounded read tools, three typed proposal tools, stale-safe approval/application, section-revision undo, and a production writing panel. The renderer receives only validated preload APIs and session-authorized replay/live events; ephemeral deltas never replace durable terminal truth, and current proposal state comes from `mutation_proposals`.

The panel supports session selection, streaming, generic activity without chain-of-thought, stop, retry/continue as new immutable runs, steering/follow-up, selection/section/project context snapshots, provider/model and usage/retry state, grouped expandable bounded tool activity, citation attachments, standalone proposal diffs, and approve/reject/undo. Accepted section edits carry model request, Agent run, tool call, proposal, revision, and cited-source lineage.

Context handling uses a deterministic token estimate with CJK/adversarial coverage and a non-throwing whole-turn transform. When real historical pressure would omit a complete turn, Main can create at most one bounded raw-event summary per session through `ModelExecutionService`; the recorded `compaction_summary` is ordinary context data, while the full event history remains authoritative. Provider reasoning controls and multi-level compaction remain deferred.

## Acceptance evidence

Checkpoint 23 passed its final gate on 2026-07-21:

- Local Biome checked 312 files with only the existing generated shadcn `document.cookie` warning.
- Node and renderer TypeScript passed.
- The canonical Electron-hosted Vitest suite passed 91 files and 402 tests.
- The production build emitted the Agent worker; the signed macOS arm64 unpacked application passed strict signature inspection.
- Electron Playwright passed all 12 scenarios. The new full workflow covers project/brief/outline/section creation, PDF import, MinerU normalization, indexing, real Pi search and proposal tool calls against loopback providers, citations, preview, approval, editor reload, full lineage, panel/project reopen, undo, streamed cancellation, and durable interrupted-state replay.
- Packaged hybrid smoke passed native search, provider-failure fallback, and stale-session scenarios. The packaged asar contains `out/main/agent-worker.js`; arm64 `better_sqlite3.node` and `vec0.dylib` are present and run under Electron ABI 148.
- An isolated real application launch produced `app.sqlite` with application ID 1464615248, user/schema version 1, `integrity_check=ok`, no foreign-key failures, and a valid schema manifest row.
- `git diff --check` passed.

Post-completion field correction (2026-07-21): a DeepSeek V4 Flash run exposed two Checkpoint 23 integration defects. Runtime logs showed that the approved Brief proposal was durably applied but the renderer kept its cached workspace, while `propose_outline_patch` failed with `stale_base` because the Agent context did not expose the authoritative outline version. The correction now includes `outlineVersion` in the bounded writing context, directs proposal tools to use the returned Brief/Outline versions and refresh once on conflict, maps stale proposal bases to a retryable `conflict` instead of a generic internal failure, and refreshes the manuscript workspace after approve/undo. The canonical Electron Vitest suite passed 91 files/403 tests; production build and Node/web typecheck passed; local Biome passed 312 files with the existing generated shadcn cookie warning; and all 12 Electron Playwright scenarios passed. The expanded Agent E2E verifies the version in the provider request and immediate Brief/Outline UI refresh after approval.

Post-completion presentation refinement (2026-07-21): Agent `search_knowledge`/`read_citations` cards now show validated knowledge-source titles and one-based pages instead of opaque citation hashes, while keeping citation IDs as metadata and backward-compatible fallbacks. Persisted and streaming assistant messages render GFM Markdown through the existing React Markdown stack with raw HTML removed, remote images suppressed, and links restricted to the application external-URL allowlist. Canonical Electron Vitest passed 92 files/407 tests; production build, Node/web typecheck, 12/12 Electron Playwright, a focused Agent E2E rerun, isolated runtime database verification, local Biome with only the existing generated shadcn warning, and `git diff --check` passed.

Post-completion response-card refinement (2026-07-21): completed assistant messages no longer repeat provider and model badges already shown in the active-run header. Per-response usage, retry, and interruption metadata remains visible. Production build, Node/web typecheck, focused Biome, `git diff --check`, and the built Electron Agent E2E passed.

Post-completion Side Chat refinement (2026-07-21): the Writing Workspace now hosts Agent chat as a responsive right-side `ResizablePanel` instead of a Sheet. Desktop widths are adjustable within the requested bounds, narrow layouts replace the manuscript while open, and each reopen starts at a session list before entering a conversation. The message timeline uses the official shadcn MessageScroller, Message, Bubble, Attachment, Marker, Resizable, and shimmer compositions; consecutive non-proposal tools project into one expandable activity group, while proposals remain standalone. Canonical Electron Vitest passed 92 files/409 tests; production build, Node/web typecheck, Biome on 320 files with only the existing generated shadcn warning, all 12 Electron Playwright scenarios, isolated runtime database verification, and `git diff --check` passed.

Post-completion field correction (2026-07-21): runtime event evidence from two DeepSeek V4 Flash runs showed repeated UUID-repair messages without any intervening outline tool execution, followed by an aborted run. The model-facing outline schema had incorrectly required the model to generate internal `createSection` UUIDs. It now accepts bounded local references and uses Pi's pre-validation `prepareArguments` hook to allocate application-owned UUIDs and rewrite all same-patch references before the worker-to-Main UUID contract is checked. The canonical Electron Vitest suite passed 92 files/407 tests; production build, Node/web typecheck, Biome on 314 files (with only the existing generated shadcn warning), all 12 Electron Playwright scenarios, isolated app-database verification, and `git diff --check` passed. The Agent E2E now proves a non-UUID local create reference succeeds through the real Pi loop.

Post-completion timeout/stop correction (2026-07-22): removed the Agent-wide request timeout and made `ProviderConfig.timeoutMs` an independent deadline for each logical provider call, including automatic retries. Tool continuations create a fresh deadline, while a linked per-run cancellation signal stops provider streams, retries, authorization waits, and in-flight tool handlers. Main drains the dedicated tool bridge before terminalizing a stopped run, preserves already-committed proposals, and classifies `provider_timeout`, `user_stopped`, `project_closed`, and generic interruption separately. Renderer timelines derive live/frozen run and tool durations from existing timestamps, show stopped tools as stopped rather than running, and label provider timeouts explicitly. Added worker, Main bridge/service, and renderer view-model coverage; canonical Electron Vitest passed 92 files/416 tests, Node/web typecheck passed, and Biome passed 320 files with only the existing generated shadcn cookie warning.

Post-completion presentation correction (2026-07-22): bounded long Outline rows and all Agent timeline leaves so hover actions, Markdown/code/tables, tool JSON, citation attachments, status metadata, and proposal content cannot expand their parent panels. The Agent trigger now lives at the far right of the global menubar and remains available through the existing keyboard shortcut. Proposal previews use exactly pinned `react-diff-viewer-continued` 4.4.0 with a highlighted unified vertical view by default, an explicit split-view switch, dark-theme styling, bounded scrolling, and truncation disclosure. Production build and Node/web typecheck passed; canonical Electron Vitest passed 92 files/416 tests; local Biome checked 321 files with only the existing generated shadcn cookie warning; `git diff --check` passed; the focused Agent workflow and all four Writing Workspace scenarios passed, including explicit panel/outline overflow assertions; the complete Electron E2E run passed 11/12 with one unrelated MinerU normalized-body timing failure that passed immediately in focused rerun. The `pnpm check` wrapper hung before producing output, so the local Biome binary was used and no final `pnpm check` pass is claimed.

Post-completion silent E2E maintenance (2026-07-22): the Main process now supports an explicit silent window presentation for Playwright and packaged hybrid smoke. Silent BrowserWindows remain hidden and unfocused, disable renderer background throttling, skip macOS Dock activation and default maximization, and ignore second-instance focus requests; normal launches remain interactive. The default E2E wrapper is silent, while `test:e2e:visible` is available for interactive debugging. The fixture asserts the hidden/unfocused/non-throttled invariant at every launch. Biome, Node/web typecheck, production build, Electron-hosted Vitest (92 files/420 tests), complete silent Electron Playwright (12/12), packaged hybrid smoke, and `git diff --check` passed. The visible command was list-checked without launching a desktop window.

Follow-up Sidebar header correction (2026-07-22): a narrow-window field screenshot showed that the first presentation pass had bounded Outline rows but not the contextual Sidebar header's intrinsic width. The composed secondary Sidebar, project/status row, and Brief/Outline grid now all opt into shrinking; the two buttons stay within their grid tracks and truncate only their labels when necessary. The production build and Node/web typecheck passed, and the complete Writing Workspace Electron scenario passed with the app resized to 900 px and direct assertions that the header has no horizontal overflow and `Edit outline` remains inside the Sidebar boundary.

Post-completion Outline row refinement (2026-07-22): hidden add/delete controls no longer reserve
flex width. Each Outline section button now fills the available row and shows its word count at rest;
hover or keyboard focus-visible replaces the count with the two overlaid actions. Focused Biome and
an independent production Renderer build passed in the active worktree. Because unrelated Agent
context/approval-policy work is currently mid-edit, the complete Node/web typecheck, production
build, and focused real Electron Writing Workspace scenario were run in a clean HEAD snapshot
carrying only this refinement; all passed, including explicit row-boundary, count, and hover-action
assertions.

Post-completion section-deletion correction (2026-07-22): an applied section proposal protected its accepted revision through `mutation_proposals.applied_revision_id`, so a later outline hard-delete correctly failed instead of cascading away immutable Agent lineage. ADR 002 and migration 0018 now make deletion an internal tombstone: every active outline/editor/Agent query excludes `deleted_at`, active position indexes ignore tombstones, IDs cannot be reused, materialization registrations are removed, and all section revisions plus proposal/model lineage remain durable. Manual and Agent deletion share the same leaf/last-section rules; deleting the active editor target flushes before approval and falls back after refresh; prior section undo reports the tombstoned target as not undoable. Local Biome checked 324 files with only the existing generated shadcn cookie warning; Node/web typecheck and production build passed; canonical Electron Vitest passed 92 files/423 tests; all 12 silent Electron Playwright scenarios passed; isolated real-app `app.sqlite` verification passed; and an online backup of the reported schema-17 project accepted migration 0018 plus the previously blocked protected-deletion transition with two revisions and both applied proposal links intact and no foreign-key failures. The `pnpm test`/`pnpm build` wrappers hung before output, so the documented direct test runner and npm build equivalent were used.

Post-completion stale section-proposal correction (2026-07-22): pending section proposals now show
`Outdated` as soon as their base revision differs from workspace truth. Approving an outdated
proposal performs an operation-aware three-way analysis inside the same immediate transaction:
non-conflicting work becomes a new pending proposal and requires a second approval, conflicting
work terminates inline with a safe reason, and reliably satisfied field updates terminate without a
revision. Migration 0019 adds the linear replacement chain and terminal states; pending bases are
protected from body pruning, the renderer projects only the latest leaf, and only final application
publishes `sectionChanged`. Local Biome (329 files, with only the existing generated shadcn cookie
warning), Node/web typecheck, canonical Electron Vitest (94 files/435 tests), production build, all
13 built-app Electron Playwright scenarios, migration backup/foreign-key coverage, isolated
app-database integrity verification, and `git diff --check` passed. The offline `pnpm` wrapper could
not verify its registry signature, so the installed Biome binary, documented direct test runner,
and npm build equivalent were used. Checkpoint 24 remains unstarted.

Focused evidence also covers lease-before-replay ordering, sequence cursor bounds/de-duplication, renderer-delivery isolation, project capability revocation, authoritative proposal state, all three start scopes, usage aggregation, CJK token estimation, oversized-current-turn safety, one-summary-only compaction, preserved raw events, and recorded compaction model requests.

Post-completion run-state correction (2026-07-22): terminal Agent events now immediately freeze the
renderer run state, and stale list responses or a fast terminal event racing the `startRun` IPC
response cannot restore `running`. Stop is idempotent after durable completion; stale steer/follow-
up failures reconcile against Main truth instead of leaving the composer wedged. Local Biome
checked 339 files with only the existing generated shadcn cookie warning; Node/Renderer typechecks,
production build, canonical Electron Vitest (96 files/448 tests), all 13 built-app Electron
Playwright scenarios, isolated app-database integrity/schema verification, and `git diff --check`
passed.

Post-completion section body correction (2026-07-22): the bounded Agent system prompt now makes
section titles explicit outline metadata rendered outside the BlockNote body. Section writing and
patching must begin with body content rather than an opening heading that repeats or restates the
target title, while genuine lower-level subheadings remain allowed. The canonical Electron-hosted
Vitest suite passed 96 files/448 tests; Biome checked 339 files with only the existing generated
shadcn cookie warning; and `git diff --check` passed. The `pnpm check` wrapper hung without output,
so the installed Biome binary was used and no `pnpm check` pass is claimed.

## Checkpoint 23 baseline before Harness v2

The earlier Checkpoint 23 baseline added model-aware Agent context budgeting and utilization, plus application-
default/session-specific `manual`, `section_auto`, and `yolo` proposal approval policies. It keeps
the then-frozen seven-tool surface and existing persistence tables. Its approval-waiter behavior is
historical and superseded by ADR 005. Checkpoint 24 and all Phase 10 work remain unstarted.

Completion evidence (2026-07-22): migration 0020, bounded models.dev resolution and cache fallback,
run-snapshotted limits and approval modes, the complete approval matrix, cancellable mutation
barriers, authoritative workspace refresh, Brief draft conflict protection, and the latest-call
context meter are implemented. Biome checked 339 files with only the existing generated shadcn
`document.cookie` warning; Node and Renderer typechecks and the production build passed; the
canonical Electron-hosted Vitest suite passed 96 files/447 tests; all 13 built-app Electron
Playwright scenarios passed; the signed macOS arm64 unpacked build and packaged hybrid smoke passed
native search, provider-failure fallback, and stale-session scenarios; isolated real-app
`app.sqlite` integrity/schema verification passed; and `git diff --check` passed. The documented
direct test runner and npm build equivalent were used because the local pnpm wrapper did not start
reliably in this environment.

## Completed Harness v2 window

The user approved Checkpoints 23H.1 through 23H.3 before Checkpoint 24. ADR 005 supersedes the
initial seven-tool list and approval-waiter semantics while preserving the closed domain-tool
surface, Main/worker trust boundary, five Agent persistence tables, typed proposals, and revision
checks. The window delivers structured tool results, complete attempt auditing, request-scoped
writing snapshots, non-blocking proposal review, Main-owned outline/block normalization,
effect-based approval, manuscript search, change inspection, and deterministic draft checks.

The Checkpoint 23H acceptance gate passed on 2026-07-22. The final implementation uses eleven
bounded domain tools, request-scoped writing snapshots, Tool Result schema v2, non-blocking
proposal review, trusted approval decisions, Main-owned SectionRef/block-hash normalization,
effect-based approval, expanded-evidence proposal provenance, stable deterministic draft checks,
and proposal ID mappings. Checkpoint 24 and all Phase 10 implementation remain unstarted and
require separate user approval.

Acceptance evidence: local Biome checked the worktree with only the existing generated shadcn
`document.cookie` warning; Node and Renderer typechecks and the production build passed; the
canonical Electron-hosted Vitest suite passed 96 files/449 tests; all 13 built-app Electron
Playwright scenarios passed, including v2 read-citations/submit, proposal pause, approval and a
fresh approval-continuation run; migration 0021 and compatibility readers passed the project
database suite; a signed macOS arm64 unpacked application passed strict deep signature validation;
packaged hybrid native search, provider-failure fallback, and stale-session smoke passed; the asar
contains `out/main/agent-worker.js`, with arm64 `better_sqlite3.node` and `vec0.dylib`; an isolated
real application produced `app.sqlite` with application ID 1464615248, user/schema version 1,
`integrity_check=ok`, no foreign-key failures, and a valid schema manifest row; and
`git diff --check` passed. The installed Biome binary and documented npm/direct test equivalents
were used because the local pnpm wrapper could not verify its registry signature offline.

## Deferred

- Provider reasoning controls, chain-of-thought display, additional Agent tools/tables, multiple agents/sub-agents, long-term memory, multi-level summaries, Pi harness JSONL storage, and per-project Agent worker processes.
- External editing synchronization, project-wide file watching, alternative vector backends, client-side MinerU page-count enforcement, and model cost estimation remain deferred as recorded in `docs/implementation-todo.md`.
