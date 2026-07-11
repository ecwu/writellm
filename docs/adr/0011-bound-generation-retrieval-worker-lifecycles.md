---
id: ADR-0011
title: Bound generation retrieval worker lifecycles
date: 2026-07-11
initiative: GEN
scope: project
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [GEN-002]
depends_on: []
external_task_gates: []
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0011: Bound generation retrieval worker lifecycles

## Context

Generation records enter `retrieving` after a retrieval-query plan is created. The subsequent embedding/retrieval work runs in a single reusable worker. The embedding request has no deadline, so an unavailable or non-responsive embedding endpoint can leave both the generation round and the worker's active task open indefinitely. Manual cancellation rejects the author-facing request but previously allowed the active worker task to keep the single-worker queue blocked.

## Decision

Apply a 45-second main-process deadline to each active generation retrieval task, including worker startup and provider work. On deadline expiry, or cancellation of an active task, reject that retrieval with a typed error, clear it from the active slot, terminate the current worker, and create a fresh worker for queued or retried retrievals.

The existing generation orchestration catches the rejection, persists the generation round as `error` (unless the author canceled it), emits `round_error`, and exposes the existing Retry action. It must not silently continue without evidence, leave the round in `retrieving`, or mutate manuscript content.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Wait indefinitely for provider or worker recovery | Rejected because an author cannot distinguish delay from a lost run and later requests can remain blocked. |
| Only abort the provider request | Insufficient: a provider or worker that ignores abort can retain the active queue slot. |
| Treat timeout as successful retrieval with no sources | Rejected because it hides a failed evidence step and could generate unsupported prose. |

## Consequences and constraints

- The deadline is internal to the main process; the renderer cannot extend or bypass it.
- Timeout and active-task cancellation intentionally discard the worker process rather than trust it for subsequent requests.
- Existing explicit Cancel remains a `canceled` terminal state; a deadline is an `error` with a user-visible retry path.
- The original decision applies to legacy generation retrieval. ADR-0019 applies the same hard-termination principle to the clean Pi `source` Worker without restoring the legacy retrieval protocol or Source v2 loop.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| GEN-002 | Implement the deadline/reset behavior and deterministic tests for timeout, cancellation, and a subsequent successful queued task. |

### Completion conditions

- [x] An unresponsive retrieval rejects at the 45-second deadline and generation orchestration records its existing `error` terminal state rather than leaving it `retrieving`.
- [x] Canceling an active retrieval terminates its worker, so the next queued retrieval starts on a fresh worker.
- [x] Deterministic fake-worker tests cover timeout and cancellation recovery without a live provider; the existing `round_error`/Retry flow receives the rejection.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Created after a query-planned generation was observed to stall indefinitely during embedding/retrieval. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | GEN-002 claimed the deadline, worker-reset, and deterministic recovery implementation. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | Added the 45-second client deadline plus timeout/cancel worker reset. Two deterministic fake-worker tests prove recovery; typecheck, all 30 unit tests, build, and Electron smoke passed. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | ADR-0019 carries the proven worker-termination lifecycle into Pi `source`; this ADR remains the implemented legacy-generation decision and is not rewritten as the Pi tool contract. |
