# Phase 29: Live Agent Request Retry And Continuation

Status: Checkpoint 80 is complete under accepted ADR 071.

Recorded: 2026-09-01

## Checkpoint 80: Retry The Failed Model Request Without Repeating The User Message

### Outcome

Replace Agent prompt-resubmission `Try again` with an explicit, capability-bound retry of the last
eligible provider request. A before-content failure retries the request; a partial-stream or
post-tool-result failure continues from the same safe Pi boundary. Neither path adds a duplicate
user message or replays a completed tool.

### Research baseline

The implementation is intentionally scoped to the repository's pinned Pi `0.80.10` runtime:

| Pi capability | Observed behavior | Checkpoint use |
| --- | --- | --- |
| `Agent.continue()` | Adds no message; requires a final user or tool-result message | Start the retried assistant turn |
| Failed provider turn | Pi appends an assistant error message | Restore the request-before-state first |
| Assignable `Agent.state` | Message and tool arrays are copied on assignment | Restore the full transcript and tool envelope |
| Pi tool lifecycle | Provider response finishes before tool execution; errors execute no tools | Retry partial responses without replaying tools |
| `isRetryableAssistantError` | Classification helper only | Retain WriteLLM-owned eligibility and budget |
| `AgentHarness` | No public manual retry/continue control in `0.80.10` | Keep the low-level Agent host |

Context7 documentation and the installed declaration/implementation files agree on these behaviors.
The checkpoint must add characterization tests so a future Pi upgrade cannot silently change them.

### Decision and authorization gate

- [x] 80.0 Obtain explicit acceptance of ADR 071, append the matching architecture amendment, mark
  the ADR accepted/authorized, and record the checkpoint start in this file, the short tracker, and
  `current-plan.md` before changing product code.
- [x] Keep ADR 012's five-attempt automatic provider retry unchanged; treat one user click as one
  new logical `model_request`, not a sixth physical attempt and not a new Agent run.
- [x] Keep ADR 069 trace payloads diagnostic-only. The live Worker anchor and Main's active run
  capability are the only retry authority.

### Work package 1: shared protocol and event schema

- [x] Add an opaque retry capability ID, retry failure-stage/reason schemas, a Worker
  `model_retry_available` event, and a Main-to-Worker one-use `authorize_model_retry` command in
  `src/shared/contracts/agent.ts`.
- [x] Add a dedicated Renderer IPC input/result in `src/shared/contracts/agent-ipc.ts`. The input
  must contain only `projectSessionId`, `agentRunId`, and retry capability ID; prompt text, editor
  context, Skill data, and model selection are forbidden.
- [x] Extend `AgentSessionRunHandle` and the worker message router in
  `src/main/providers/gateways.ts`, `src/main/providers/agent-model-client.ts`, and
  `src/workers/agent-model.ts` with exact project/session/run/capability validation.
- [x] Add `model_retry` to Agent event schema v4 with a bounded payload containing source/target
  model-request IDs, stage, reason, trigger `user`, and timestamp. Add forward project migration
  0042 after current migration 0041; preserve all existing rows, foreign keys, indexes, mutation
  proposal references, and compatibility metadata.
- [x] Extend trace capture with optional retry-parent correlation while retaining the original
  semantic purpose. Set `parent_span_id` to the source model-request span without reading traces to
  authorize or construct context.

### Work package 2: Worker retry anchor and Pi continuation

- [x] In `src/workers/agent-session-run.ts`, capture a deep request-before Pi transcript plus exact
  system prompt, tools, active tool groups, interaction mode, runtime token budget, transformed
  context, and canonical SHA-256 fingerprint before every provider request.
- [x] Keep only the latest eligible anchor. Revoke it on successful request settlement, a later
  request boundary, Stop, review/input pause, project close, run finalization, protocol error, or
  Worker termination.
- [x] After automatic physical retries finish, classify the final provider error using the existing
  provider-neutral rules. Enter a waiting latch only for transient provider failures; report the
  failed `model_request` and interrupted assistant output before advertising retry.
- [x] On a valid authorization, restore the full transcript without the failed assistant message,
  restore the exact system/tool/budget state, install the one-shot transformed-context override,
  enqueue the newly authorized model-request ID, and call `agent.continue()`.
- [x] Recompute the canonical harness-context fingerprint before `streamSimple` can perform network
  I/O. Reject a mismatch as `retry_context_mismatch`; abort the new row and terminate safely.
- [x] Preserve the original request purpose and normal five-attempt physical retry wrapper for the
  new logical request. Never mutate, reopen, or increment the source `model_request`.
- [x] Add a retry queue barrier: detach mirrored Steer/Follow-up items from Pi while retrying,
  preserve Main's queue order and IDs, then restore them only after the retried turn settles. Block
  new Steer while waiting and continue to permit bounded Follow-up queueing.

### Work package 3: Main authority, persistence, and lifecycle

- [x] Add `retryRequest(agentRunId, capabilityId)` to `AgentSessionService`. It must require an
  active run/handle, exact latest capability, a persisted retryable source failure, no later model
  request, no uncertain tool/effect boundary, and no review, clarification, cancellation, or close.
- [x] Create the target `model_request` with request fingerprint metadata
  `{ delivery: "retry_last_request", sourceModelRequestId, stage, contextFingerprint }`. Append the
  `model_retry` event before Worker authorization; if either durable write fails, send nothing.
- [x] If Worker delivery fails after durable creation, abort the target request as
  `retry_delivery_failed` and terminalize the run without falling back to prompt resubmission.
- [x] Extend active-run state and `agentProjectActivitySnapshot` with `retry_available` plus a bounded
  retry descriptor. The live run continues to occupy its existing work slot and retains Stop,
  project-close, credential, correlation, and completion ownership.
- [x] On successful retry, clear the descriptor and resume normal running projection. On a second
  eligible failure, replace it with a fresh one-use capability linked to the latest failed request.
  Double-clicks and stale activity snapshots must be harmless.
- [x] Update `context-checkpoint.ts` and all event projections so schema-v4 `model_retry` records are
  audit history only and never become model-authored conversation text or mutation authority.

### Work package 4: IPC, preload, and Renderer behavior

- [x] Register a dedicated Agent retry IPC channel in `src/shared/contracts/channels.ts` and
  `src/main/ipc/agent-ipc.ts`; authorize the sender and active `projectSessionId` exactly like other
  project-scoped Agent mutations.
- [x] Expose the parsed method through `src/preload/agent-api.ts` and
  `src/preload/desktop-api.ts`; do not expose Worker state or raw error bodies.
- [x] Replace `startRun(latestPrompt, reuseSkillFromRunId)` in
  `src/renderer/src/features/agent/agent-panel-view.tsx` with a dedicated method in
  `use-agent-panel-controller.ts`. Remove `latestPrompt` as retry authority; it may remain only for
  ordinary display or explicitly user-authored new requests.
- [x] Render `Retry request` for a before-content network failure and `Continue` for a
  partial-stream or post-tool-result failure. Keep the interrupted partial answer visually
  separate; the next response starts clean and is not concatenated.
- [x] Project retry waiting through the live activity snapshot, disable Steer, preserve
  queued Follow-ups, retain Stop, and show a non-spinning failure explanation. While the command is
  in flight, disable the button to prevent duplicate clicks.
- [x] Remove generic `Try again` from non-eligible terminal runs. If product design retains a
  fallback, label it `Send as new request`, explain that it creates another turn, and require an
  explicit click; never invoke it automatically.

### Required failure matrix

| Failure boundary | Action | Context behavior | Tool behavior |
| --- | --- | --- | --- |
| Network/rate-limit/5xx before first content | `Retry request` | Restore identical request boundary; no user event | No tool to replay |
| Stream ends after visible text/thinking | `Continue` | Discard failed assistant from Pi; retain interrupted UI event | No tool from failed response ran |
| Stream ends after partial tool-call content | `Continue` | Regenerate the assistant response | Partial tool call never executes |
| Next model call fails after completed tool results | `Continue` | Resume from existing atomic assistant/tool-result batch | Completed tools are not rerun |
| Context overflow | Existing ADR 019 recovery only | Existing bounded compaction rule | Existing no-replay rule |
| Auth/quota/billing/policy/invalid model | No request retry | Terminal failure | None |
| Tool execution or uncertain effect failure | No request retry | Terminal failure | Never replay |
| Trace capture/setup/Skill routing failure | No request retry | Terminal failure | None |
| User Stop/project close | No request retry | Revoke anchor | Abort normally |
| Worker/app restart | No request retry | Anchor unavailable; no trace recovery | Never replay |

### Tests and acceptance criteria

- [x] Pi characterization: `continue()` adds no message; failed assistant state rejects direct
  continuation; state restore succeeds; provider error executes no tool; continuation from a tool
  result executes only the next model request.
- [x] Worker: before-content, mid-text, mid-thinking, partial-tool-call, and post-tool-result
  failures produce one offer; retry uses a new model-request ID, identical context fingerprint, and
  no duplicate user message or tool dispatch.
- [x] Worker: automatic attempts stay capped at five per logical request; each user click starts a
  fresh logical request whose attempts start at one; permanent and context-overflow errors never
  enter retry waiting.
- [x] Worker queue ordering: pre-existing and newly queued Follow-ups remain ordered; Steer is not
  injected into the retried context; stale authorizations, double authorization, altered context,
  and revoked anchors perform zero network calls.
- [x] Main/database: source request remains failed, target request has independent outcome/usage,
  `model_retry` lineage is durable, trace parent correlation is correct, and persistence/delivery
  failures fail closed.
- [x] Migration/recovery: v41-to-v42 preserves every event and proposal FK, backup and integrity
  checks pass, interrupted migration restores safely, clone/snapshot round trips include the new
  event, and unsupported future schemas remain rejected.
- [x] Renderer/controller: the retry command carries no prompt, labels match stage, partial output
  is not concatenated, action is disabled in flight, Stop still works, and non-eligible errors do
  not show a misleading retry.
- [x] Electron E2E with the local mock provider proves a long prompt appears once in the second
  provider context for both before-content and mid-stream failure, and a completed mock tool is
  invoked exactly once when the following provider request is retried.

Checkpoint 80 is accepted only when all tests prove these invariants:

1. one source user action produces one durable `user_message`, regardless of request retries;
2. every explicit click produces exactly one new immutable logical `model_request`;
3. the retry's canonical provider context matches the failed request boundary before network I/O;
4. failed partial assistant output never becomes retry context or merges with regenerated output;
5. completed or uncertain tools/effects are never replayed; and
6. restart and stale-capability paths fail closed rather than degrading into prompt resubmission.

### Verification gates

- Focused shared-contract, Pi characterization, provider-stream, Worker session-run, Main service,
  trace, migration/recovery, IPC/preload, controller, view-model, and panel tests.
- `pnpm check:fast`.
- Canonical Electron suite and production build through `pnpm check:electron`.
- Fresh mock-provider Electron E2E through `pnpm check:e2e`; run outside the sandbox when Electron
  process/loopback control requires it.
- `git diff --check` and a scoped review that confirms logs contain only safe IDs, stages, counts,
  status codes, hashes, and durations.
- No package or release gate is required unless implementation changes a dependency, native module,
  worker entrypoint, packaged resource, or release boundary. The database migration still requires
  the repository's forward-migration backup, integrity, and recovery coverage.

### Explicitly deferred

- Retry or continuation after application/Worker restart.
- Durable Agent jobs, leases, heartbeats, or background retry.
- Token-offset stream resumption or concatenation of partial provider output.
- Provider-specific retry forks, direct provider SDK calls, a Pi fork, or `AgentHarness` migration.
- Automatic retry after published content.
- Replaying failed tools, mutations, image generation, or any external effect.

### Local evidence

- `pnpm check:fast` passed after the final protocol, migration, Main, Worker, IPC, preload, and
  Renderer changes.
- The canonical Electron gate passed 228 test files with 1,240 tests; three benchmark files/tests
  remained intentionally skipped, and the production build succeeded.
- The focused `agent.request-retry` Electron scenario passed both before-content and interrupted
  stream paths, proving exact provider-request body reuse and one durable user message per long
  request.
- The complete fresh Electron E2E suite passed all 49 scenarios without flakes, skips, or failures.
- The complete no-Team-ID macOS arm64 package gate verified 31 recovery fixtures from 29 sources,
  53,318 ASAR entries, all 12 packaged runtime smoke scenarios, and all 34 packaged Electron
  scenarios. It produced the unpacked App, DMG, and ZIP under `dist/macos-arm64`.
- `git diff --check` passed. No package, release, commit, tag, push, signing, notarization,
  promotion, or publication action was performed before the separately requested package build;
  that build performed no release, commit, tag, push, signing, notarization, promotion, or
  publication action.
