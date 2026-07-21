# WriteLLM Current Plan

Status: Phase 9 Checkpoints 20 through 23 completed and verified; Checkpoint 24 is not started and requires explicit approval.
Recorded: 2026-07-21

## Completed scope

Phase 9 is complete. WriteLLM now has project-local durable Agent sessions, request-scoped runs, ordered events, four bounded read tools, three typed proposal tools, stale-safe approval/application, section-revision undo, and a production writing panel. The renderer receives only validated preload APIs and session-authorized replay/live events; ephemeral deltas never replace durable terminal truth, and current proposal state comes from `mutation_proposals`.

The panel supports session selection, streaming, generic activity without chain-of-thought, stop, retry/continue as new immutable runs, steering/follow-up, selection/section/project context snapshots, provider/model and usage/retry state, structured bounded tool cards, citations, proposal diffs, and approve/reject/undo. Accepted section edits carry model request, Agent run, tool call, proposal, revision, and cited-source lineage.

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

Post-completion field correction (2026-07-21): runtime event evidence from two DeepSeek V4 Flash runs showed repeated UUID-repair messages without any intervening outline tool execution, followed by an aborted run. The model-facing outline schema had incorrectly required the model to generate internal `createSection` UUIDs. It now accepts bounded local references and uses Pi's pre-validation `prepareArguments` hook to allocate application-owned UUIDs and rewrite all same-patch references before the worker-to-Main UUID contract is checked. The canonical Electron Vitest suite passed 92 files/407 tests; production build, Node/web typecheck, Biome on 314 files (with only the existing generated shadcn warning), all 12 Electron Playwright scenarios, isolated app-database verification, and `git diff --check` passed. The Agent E2E now proves a non-UUID local create reference succeeds through the real Pi loop.

Focused evidence also covers lease-before-replay ordering, sequence cursor bounds/de-duplication, renderer-delivery isolation, project capability revocation, authoritative proposal state, all three start scopes, usage aggregation, CJK token estimation, oversized-current-turn safety, one-summary-only compaction, preserved raw events, and recorded compaction model requests.

## Current scope

No implementation checkpoint is active. Checkpoint 24 and all Phase 10 work remain unstarted until the user explicitly approves continuation. Do not start export, packaging-product work, or later roadmap items from this record alone.

## Deferred

- Provider reasoning controls, chain-of-thought display, additional Agent tools/tables, automatic low-risk proposal application, multiple agents/sub-agents, long-term memory, multi-level summaries, Pi harness JSONL storage, and per-project Agent worker processes.
- External editing synchronization, project-wide file watching, alternative vector backends, client-side MinerU page-count enforcement, and model cost estimation remain deferred as recorded in `docs/implementation-todo.md`.
