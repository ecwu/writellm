---
id: ADR-0012
title: Replace interactive generation with the Pi Agent event runtime
date: 2026-07-11
initiative: PIA
scope: project
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-010]
related_tasks: [GEN-002, PIA-004, PIA-005, PIA-006, PIA-007, PIA-008, PIA-009, PIA-010, PIA-011, PIA-012, PIA-013, PIA-014, PIA-015, PIA-016, PIA-018, PIA-019]
depends_on: [ADR-0002, ADR-0003, ADR-0004, ADR-0008, ADR-0009, ADR-0010, ADR-0011]
external_task_gates: [SEC-001, SEC-002, SEC-003, DAT-001, REL-001]
supersedes: [ADR-0001, ADR-0007]
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0012: Replace interactive generation with the Pi Agent event runtime

## Context

The current interactive generation path is a hand-written linear state machine: it plans retrieval queries, calls the retrieval worker, then invokes a one-shot structured LLM proposal. The renderer reconstructs progress from legacy generation-round statuses and retrieval traces. A recent retrieval failure demonstrated the operational weakness of that arrangement: once the worker deadline expires, the author can only see that it timed out, not which bounded operation failed or whether a retry is meaningful.

ADR-0011 now guarantees that a stuck retrieval worker reaches a terminal state. It does not make the overall pipeline a coherent multi-step runtime, nor does it give the author a first-class view of retrieval, tool progress, drafting, and bounded recovery.

The earlier Pi initiative intentionally kept Pi as an optional mode alongside the legacy quick-generation path. The product direction has changed: every interactive writing-generation action must be rebuilt on Pi Agent Core, and its run-event model must drive the author-facing progress view. The existing review-only `WritingPatch` boundary remains mandatory.

Pi Agent Core's public `Agent` API emits ordered `agent_start`/`agent_end`, `turn_start`/`turn_end`, `message_start`/`message_update`/`message_end`, and `tool_execution_start`/`tool_execution_update`/`tool_execution_end` events. It does not ship an Electron renderer or license a terminal UI to be embedded in this application. Therefore “use Pi's presentation form” means preserving that event grammar and ordering in a safe desktop projection, not importing the Pi coding-agent CLI or a terminal UI.

## Decision

Make `@earendil-works/pi-agent-core`'s `Agent` the sole runtime for every interactive generation entry point after the cutover. The `AgentManager` in Electron main owns run creation, provider-adapter invocation, context bounds, tool registration, budgets, cancellation, timeout, live-event projection, and terminalization. The renderer reaches it only through typed IPC.

The `Agent` public event stream is the canonical progress contract. Renderer-visible events are a redacted, bounded projection of that stream, with semantic order and a monotonic sequence number preserved. ADR-0019 clarifies that projection is not one IPC message per provider token: adjacent text deltas are coalesced, flushed before lifecycle boundaries, and committed by the renderer at animation-frame cadence. The UI renders Pi's lifecycle as an ordered run/turn/tool activity view plus incremental draft text rather than rebuilding a separate legacy `GenerationEvent`/retrieval-trace timeline:

| Pi event family | Desktop presentation |
| --- | --- |
| `agent_*` | Run start, terminal status, duration, budget outcome, and retry affordance. |
| `turn_*` | Expandable turn boundary showing whether the agent is planning, reacting to tools, or finalizing. |
| `message_*` | Streamed assistant content is rendered incrementally from bounded coalesced deltas; internal message boundary/delta events need not appear as activity rows. |
| `tool_execution_*` | Named, allowlisted WriteLLM tool activity, bounded progress, source/provenance references, and result status. |

WriteLLM may add narrowly defined lifecycle events for provider preflight, patch validation, and author review because they are outside Pi's loop. They must be attached to the same run sequence, identify `origin: "writellm"`, and must not recreate the legacy generation-round state model. The renderer must never receive raw provider objects, credentials, unrestricted tool arguments/results, hidden reasoning, or chain-of-thought.

`source` becomes the Pi knowledge-retrieval tool. It uses the clean, bounded RAG service with independent embedding, rerank, and 45-second total deadlines. A retrieval deadline becomes a `tool_execution_end` failure with a typed, retry-safe terminal classification; it cannot leave the run in an indefinite retrieving state. Every terminal error shown to the author includes, without secrets or raw prompts, the failing stage, tool when applicable, category, retryability, and a concise cause. At minimum the implementation distinguishes provider authentication/configuration, provider transport/timeout, embedding/retrieval timeout, tool-policy denial, run-budget exhaustion, cancellation, and patch-validation failure.

The model-adapter choice remains open in ADR-0005 and is still owned by PIA-004. Its proof must now cover all current interactive action shapes, not merely a new opt-in agent action. The adapter remains the only Pi-version-specific provider boundary.

At the completed cutover, remove the active legacy generation pipeline rather than retaining it as a parallel fallback: legacy generation orchestration, legacy event/status types and subscriptions, renderer trace presentation, obsolete IPC, and their dead tests are deleted once their replacement has verified parity. Shared capabilities remain only when they are explicitly reused behind a Pi tool or the existing patch-review boundary. In particular, retrieval services are retained as `source` implementation details and `WritingPatch`/author Apply remains unchanged.

ADR-0018 supersedes historical-record retention for this cutover. PIA-005 deletes legacy generation records and tables without archive or migration compatibility while preserving author documents and indexed knowledge sources. No new record may be written through the old generation schema or IPC path.

The former optional `agent.enabled` flag is replaced at cutover by a main-process `generation.enabled` kill switch. It defaults to enabled in the rebuilt product. Disabling it rejects new generation safely and leaves author documents and indexed sources readable; it does not route requests back to the removed legacy generator.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Keep the legacy pipeline and add Pi only for complex workflows | Rejected: it preserves two execution and presentation contracts, duplicates lifecycle work, and leaves the observed retrieval failure opaque in routine writing. |
| Display Pi-like stages while retaining the hand-written generator | Rejected: a visual imitation would still have divergent event ordering, cancellation, and error semantics. |
| Embed the Pi coding-agent CLI or terminal UI | Rejected: it is not an Electron presentation component and exceeds WriteLLM's permission and data boundaries. |
| Keep a hidden legacy runtime fallback after cutover | Rejected: it makes behavior, diagnostics, tests, and security policy non-deterministic. The bounded kill switch is the rollback mechanism. |

## Consequences and constraints

- The project has one active generation runtime and one author-facing run timeline after cutover; it must not fork behavior by action type.
- No agent tool obtains shell, arbitrary filesystem, Git, network, settings, raw database, direct document mutation, dynamic extension, or Pi resource-loader access. ADR-0003 and ADR-0004 remain binding.
- A Pi run's tools execute sequentially in the MVP so the trace, evidence manifest, cancellation, and budget enforcement are deterministic.
- The existing 120-second run budget, 6-turn, 2-search, and 8-tool-call limits remain defaults until a later ADR changes them. Tool-specific deadlines, including the retrieval deadline, must be visibly classified within that run budget.
- Event projection must apply backpressure: preserve complete ordered text and semantic boundaries while bounding IPC/render frequency. Provider token timing and token-to-event cardinality are not public contracts.
- Blocking `source` work executes in the ADR-0019 Worker boundary so main-process run ownership does not make cancellation or workspace interaction wait for embedding, sqlite-vec, or FTS.
- The deletion plan must enumerate every legacy main-process module/call site, IPC channel, preload/API method, shared type, database writer, renderer component/state subscription, test fixture, and documentation reference. A simple unused-import cleanup is insufficient.
- A pre-cutover implementation branch may retain old code solely to complete the replacement. It may not expose both active pipelines to the author. The final cutover task deletes the old path and proves no remaining renderer-to-main route can invoke it.
- Provider and embedding configuration remain independent capabilities. A Pi runtime cannot turn a missing API key, unsupported model, or unresponsive endpoint into a generic “timeout”; preflight and terminal classifications must make the relevant configuration scope clear without exposing its value.

## Linked implementation work

Task state, owner, and evidence are canonical in the project task tracker.

| Task | Contribution to this decision |
| --- | --- |
| PIA-018 | Produce the complete legacy-pipeline inventory, target-to-replacement map, archival plan inputs, and deletion acceptance manifest before implementation begins. |
| PIA-019 | Define the Source v2-to-`source` tool boundary before PIA-007 implements retrieval for Pi. |
| PIA-004 | Select and prove the Pi provider/model adapter for every current interactive action shape. |
| PIA-005 | Purge legacy LLM data while retaining the knowledge index and define ephemeral live Pi-run state; PIA-016 deletes the obsolete tables with their callers. |
| PIA-006 | Implement the sole main-process Pi runtime and replace legacy orchestration. |
| PIA-007 | Adapt bounded retrieval/context/patch capabilities into allowlisted tools with classified errors. |
| PIA-008 | Retain the existing review-only patch protocol as the Pi proposal boundary. |
| PIA-009 | Replace legacy generation IPC/types with the safe Pi event projection contract. |
| PIA-010 | Implement the Pi-event-driven author timeline, tool/evidence display, terminal diagnostics, and review UI. |
| PIA-011 | Enforce run/tool deadlines, cancellation, workspace lifecycle, locks, and retry semantics. |
| PIA-012 | Add deterministic event-order, error-classification, index-retention, no-legacy-route, and regression coverage. |
| PIA-013 | Smoke-test the full Pi generation path without direct document mutation. |
| PIA-014 | Evaluate parity, usefulness, diagnostics, and release blockers against the retired pipeline's supported actions. |
| PIA-015 | Update user-facing and engineering documentation after the new contract is verified. |
| PIA-016 | Perform the one-way cutover, remove legacy code and history, and rehearse the kill switch. |
| GEN-002 | The legacy worker timeout remediation remains active only until PIA-016 removes the old retrieval route; the Pi `source` tool owns its clean direct RAG deadlines. |

### Completion conditions

- [ ] PIA-018 provides a reviewed deletion manifest covering main, IPC/preload/API, shared types, persistence writers, renderer, tests, and documentation; every item has a replacement, authorized deletion, or explicit retained-tool rationale.
- [ ] Every interactive generation request and retry uses one Pi `Agent` path; no active renderer or IPC route can start the removed legacy pipeline.
- [ ] The UI presents ordered, redacted Pi event projections and displays actionable, typed failures instead of an undifferentiated timeout.
- [ ] `source` preserves provenance and turns its 45-second deadline/cancellation into an inspectable Pi tool outcome without hanging the run.
- [ ] The existing `WritingPatch` validation and explicit author Apply/Save Candidate/Reject boundary remain intact.
- [ ] A destructive-cutover test proves author documents and indexed knowledge sources survive while legacy LLM tables and history are removed, as authorized by ADR-0018.
- [ ] Deterministic tests, Electron smoke, and the evaluation corpus prove the full cutover, cancellation, error classification, no-direct-write boundary, and absence of a legacy active fallback.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Product direction changed from an optional Pi mode to a full replacement of the interactive generation runtime and presentation contract. Supersedes the separate-agent scope in ADR-0001 and legacy-fallback flag policy in ADR-0007; no pipeline code has been migrated under this decision. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | ADR-0018 authorizes clean-slate LLM/RAG replacement: retain indexed knowledge and author documents, but delete all legacy LLM history and compatibility during cutover. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-004 through PIA-009 implemented the Pi adapter, direct bounded RAG `source`, in-memory AgentManager, review-only patch bridge, and typed active entry/IPC projection. Full legacy code deletion and remaining UI/lifecycle/evaluation gates are tracked separately. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Live use exposed two responsiveness gaps in the first event/runtime projection. ADR-0019 now requires coalesced/backpressured text events and isolates the complete Pi retrieval operation from Electron main while retaining main-owned AgentManager authority and ordered terminal semantics. |
