# ADR 041: Agent Pending Follow-up Queue

Status: accepted for Checkpoint 49; implementation authorized
Date: 2026-08-13

## Context

ADRs 015 and 040 keep running messages as Follow-up by default and expose Queue, Steer, and Stop as
separate composer controls. Hands-on use showed that the permanent Queue label and disclosure take
too much horizontal space, while a queued message cannot be inspected, promoted to Steer, or
deleted before Pi consumes it.

The pinned `@earendil-works/pi-agent-core` 0.80.10 runtime exposes only whole steering/follow-up
queue clearing. It has no stable public identifier or single-item cancellation API. Persisting a
queued message as ordinary conversation history before Pi consumes it would also make deletion
false: future context could contain text the model never received.

## Decision

WriteLLM owns a bounded, addressable pending Follow-up queue for each active run. Main owns the
Renderer-visible queue and its pre-authorized model-request records; the agent worker mirrors its
order but places only the current head in Pi's Follow-up queue. The next item is loaded only after
the head is consumed or removed. A run accepts at most 20 pending items and 1 MiB of aggregate
UTF-8 content.

Queue mutations use capability-bound, correlated worker commands. Deleting an item removes only
that item. Promoting an item first reserves it out of Follow-up order, then commits it to Pi's
Steering queue after Main has durably recorded the promoted user message. Other pending items keep
their order. Direct Cmd/Ctrl+Enter steering retains the existing path.

When Pi consumes a Follow-up, an awaited worker event forms a persistence barrier: Main validates
the exact active-run item and durably appends its `user_message` before acknowledging the worker.
Only then may the provider request start. Deleted or otherwise unconsumed text never becomes Agent
history. Its already-created `model_requests` row is aborted with a bounded reason instead.

Pending content remains request-scoped memory. It survives Agent-panel and conversation switching
through the Main-owned project activity snapshot, but Stop, review pause, run failure, project
close, worker termination, or application relaunch cancels it. Interactive runs remain
non-recoverable and no queue table or durable job is added.

The running composer has one terminal action position. With an empty draft it shows Stop; with a
non-empty draft it shows the circular ArrowUp action and queues on Enter. Cmd/Ctrl+Enter steers
directly and Shift+Enter inserts a newline. Pending messages appear in a bounded, internally
scrolling list above the composer with per-item Steer and Delete actions.

## Consequences

Main and the worker gain a narrow pending-message protocol, the live-run activity snapshot gains a
bounded pending-message projection, and Preload gains delete/promote IPC methods. Provider-call,
project-session, Renderer sandbox, proposal, model, and approval authorities remain unchanged.

This amends ADR 015's running composer presentation, ADR 018's Queue/Steer live snapshot, and ADR
040's decision to leave running controls unchanged. It adds no dependency, database migration,
worker role, background recovery, model capability, direct manuscript authority, package/release
work, or hosted CI work.
