---
id: ADR-0019
title: Isolate Pi retrieval and backpressure live events
date: 2026-07-11
initiative: PIA
scope: project
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-002, PIA-D-004, PIA-D-010]
related_tasks: [PIA-006, PIA-007, PIA-009, PIA-010, PIA-011, PIA-012, PER-001]
depends_on: [ADR-0002, ADR-0011, ADR-0012, ADR-0016, ADR-0017, ADR-0018, ADR-0020]
external_task_gates: [REL-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0019: Isolate Pi retrieval and backpressure live events

## Context

The first Pi vertical slice exposed two independent responsiveness failures that compile-time and deterministic provider tests did not reveal.

First, Pi emitted a `message_update` for each streamed token. The main process projected each update immediately over Electron IPC, while the renderer copied its event history, reconstructed the complete draft, and rendered internal `message_delta` rows. Long or high-throughput output therefore created an unbounded producer/consumer mismatch and could make the window appear unresponsive.

Second, the clean `source` implementation correctly removed the legacy Source v2 loop, but initially executed embedding, sqlite-vec search, FTS, and optional reranking through the active `WriteLLMDatabase` in Electron main. During a live retrieval the renderer's CSS animation continued, but interactions that required main-process IPC, including Cancel, could not be serviced while synchronous native SQLite work occupied main. A moving spinner was therefore not evidence that the whole application remained interactive.

These failures refine, rather than reverse, the existing trust boundary. Pi orchestration, credentials, policy, run locks, and terminal ownership remain in Electron main under ADR-0002. Potentially blocking retrieval work must not share that event loop, and renderer event delivery must preserve semantic order without mirroring provider token frequency one-for-one.

## Decision

### Runtime ownership

Keep `PiAgentManager`, the Pi `Agent`, provider preflight, tool authorization, run budgets, section locks, lifecycle registration, terminal classification, and renderer IPC in Electron main.

Execute each Pi `source` call in a dedicated Node Worker. The Worker receives an immutable, minimum-necessary snapshot containing the workspace path, validated query, bounded retrieval options, provider settings required for embedding/rerank, and the already-evaluated outbound-data policy under ADR-0020. It does not read Electron `safeStorage`, access the renderer, invoke Pi, mutate author content, or persist credentials.

The Worker owns the complete blocking retrieval operation: query embedding, sqlite-vec lookup, FTS, candidate fusion, optional reranking, and bounded provenance formatting. Electron main retains the authoritative 45-second deadline and run `AbortSignal`. Cancellation, deadline expiry, worker error, or abnormal exit terminates the Worker and yields one classified `source` failure; a stuck Worker is never trusted for a later call.

### Event backpressure

Treat Pi events as an ordered semantic stream, not a requirement for one IPC message per provider token.

- Main coalesces adjacent assistant text deltas on a short cadence, splits them at the existing 4,000-character event bound, and flushes pending text before message, tool, turn, or terminal boundaries.
- High-throughput streams periodically yield from the awaited Pi subscriber to the native event loop so Electron timers, cancellation, window events, and IPC remain serviceable.
- The renderer queues incoming projections and commits state at most once per animation frame. Streamed draft text is maintained incrementally and bounded independently from the semantic event timeline.
- Monotonic sequence order, final text, tool boundaries, failures, and terminal status must be preserved. Token-to-event cardinality and token timing are explicitly not part of the public IPC contract.
- Internal `message_start`, `message_delta`, and `message_end` records need not appear as user-facing activity rows. The UI presents meaningful run/turn/tool state and identifies active RAG work explicitly.

### Interaction contract

The live assistant surface is non-modal. It may reserve layout space where necessary, but it must remain collapsible and must not cover most of the writing workspace. During embedding/retrieval the author can continue renderer-local interactions and can request cancellation; main must process that request without waiting for SQLite or the external embedding endpoint to return.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Keep all tool work in Electron main and add longer timeouts | Rejected: a deadline cannot fire promptly when synchronous native work owns the event loop, and the UI remains unable to cancel or switch workspaces. |
| Move the complete Pi Agent into a Worker | Rejected: it complicates run/IPC/lifecycle ownership and moves privileged orchestration away from the established main-process security boundary. |
| Reuse the legacy retrieval worker and Source v2 protocol | Rejected: ADR-0017 and ADR-0018 prohibit restoring the hidden legacy planning/evaluator loop or its presentation contract. |
| Send every token and optimize only React rendering | Rejected: it leaves Electron IPC and main/renderer serialization proportional to provider token rate. |
| Drop streamed text entirely | Rejected: incremental feedback is useful and can be retained safely with bounded batching. |

## Consequences and constraints

- A `source` call pays Worker startup and an additional read-only SQLite connection cost. Responsiveness and hard termination take priority over reusing an event-loop-blocking main-process connection.
- Workspace data remains canonical in the existing database. The Worker is an execution boundary, not a new persistence or migration boundary.
- Provider credentials exist ephemerally in Worker memory only for the authorized retrieval call. They are never included in events, logs, tool results, or renderer payloads.
- Worker termination is the cancellation fallback even if `fetch`, sqlite-vec, FTS, or rerank code fails to observe an abort signal.
- Event batching must not reorder a delta after the message/tool/terminal event it belongs to or truncate high-throughput output at a batch boundary.
- PER-001 must establish representative scale budgets and measurements; this ADR removes known unbounded behavior but does not claim a general scalability threshold.

## Linked implementation work

Task state, owner, and evidence are canonical in the project task tracker.

| Task | Contribution to this decision |
| --- | --- |
| PIA-006 | Preserve main-owned AgentManager lifecycle while yielding high-throughput event subscribers. |
| PIA-007 | Execute the complete clean `source` operation behind the dedicated Worker boundary. |
| PIA-009 | Keep coalesced events ordered, redacted, bounded, and typed across IPC. |
| PIA-010 | Incrementally render streamed text, omit token noise, expose RAG state, and keep the hub non-modal. |
| PIA-011 | Prove cancel, timeout, worker failure, workspace switch, and terminal cleanup. |
| PIA-012 | Add high-throughput event and Worker lifecycle regression coverage. |
| PER-001 | Define representative generation/retrieval responsiveness and resource budgets. |

### Completion conditions

- [x] Pi `source` embedding, sqlite-vec, FTS, fusion, and rerank execute outside Electron main.
- [x] Main-process text projection is coalesced/bounded and the renderer commits queued events at most once per animation frame.
- [x] A real Electron-runtime loopback embedding smoke completes in the Worker while main-process timers continue advancing.
- [x] The live UI identifies active source retrieval, removes token-level activity noise, and leaves the writing workspace reachable.
- [ ] Deterministic tests prove cancellation/deadline terminates the Worker and a later `source` call starts cleanly.
- [ ] The full Pi Electron smoke proves retrieval, cancellation, proposal review, and workspace interaction under representative output/index load.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Accepted after live generation showed token-level event flooding and main-process Pi retrieval could each remove interactivity. Implemented a dedicated per-search Worker, authoritative cancel/deadline termination, 50 ms/4,000-character delta batching, periodic native-event-loop yields, animation-frame renderer commits, incremental bounded draft state, explicit RAG status, and a narrower non-modal hub. Thirteen targeted tests, both TypeScript configs, production build, Electron smoke, and a real loopback Worker check passed; remaining PIA-011/PIA-012/full-path evidence keeps the roll-up in progress. |
