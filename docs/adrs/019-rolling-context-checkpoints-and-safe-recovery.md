# ADR 019: Rolling Context Checkpoints And Safe Recovery

Status: accepted for Checkpoint 28.5
Date: 2026-08-12

## Context

Checkpoint 28.4 permits three concurrent Agent conversations in one project and keeps their
request-scoped state isolated inside one shared Agent Worker. The earlier conversation compaction
path predates that concurrency model: it estimates history before the final system prompt and
Writing Skill are known, writes at most one summary, loads only a bounded event window, and infers
the compaction model-request ID by querying the newest request for a run. That can omit history
without an explicit checkpoint and can mis-associate concurrent title and compaction requests.

Raw `agent_events`, mutation proposals, citation records, and manuscript/project rows already own
the durable truth. A separate memory store or recoverable background compaction job would duplicate
authority and add a lifecycle that this desktop product does not need.

## Decision

Keep raw Agent events and project business tables as the only authority. Model-visible conversation
history is rebuilt from the latest successful rolling checkpoint, a continuous recent tail beginning
after that checkpoint, and current authoritative project context. Checkpoints remain ordinary
`agent_events` rows; no compaction or long-term-memory table is introduced. Legacy summaries remain
readable and are naturally replaced by a v2 checkpoint at the next successful compaction.

Main owns a pure `AgentContextPlanner`. Planning occurs only after resolving the conversation model,
routing the Writing Skill, and composing the final system prompt and current request. The planner
accounts for system text, the exact Worker-advertised tool descriptions and parameter schemas,
conversation history, current request, reserved output, and a five-percent safety buffer clamped to
4,096–16,384 tokens. The current request is never recursively string-truncated; if fixed context plus
that request cannot fit, the run fails with `current_turn_too_large` before provider work begins.

Automatic compaction triggers when the continuous checkpoint-plus-tail exceeds the conversation
budget or the 200-event/2-MiB runtime envelope would otherwise omit uncheckpointed history. It rolls
forward across complete turn/run boundaries, persists every successful step immediately, and targets
checkpoint plus recent tail at no more than the smaller of 24,000 tokens and half of the conversation
budget. Automatic work is limited to four steps and manual work to eight. Each checkpoint covers one
continuous interval, cites its predecessor, records safe typed proposal/approval/citation/tool facts,
and never becomes manuscript, proposal, citation, or instruction authority.

Main projects each compaction step as plain serialized typed JSON containing its authority and
covered sequence interval. The bounded compaction task template adds the single model-visible
semantic wrapper and performs the single delimiter-significant escape pass; the projection layer
does not pre-wrap or pre-escape that payload.

Compaction uses the conversation's resolved provider, model, credential envelope, limits, and
transport compatibility with tools disabled. The internal model execution API returns the exact
`modelRequestId` with its result. Automatic compaction is correlated to its current `agentRunId`;
manual compaction uses `agentRunId: null` and `operationId = compactionId`.

Generalize ADR 018's three run slots into three project-level Agent work slots. A conversation may
hold one run or one manual compaction reservation. Manual compaction is request-scoped and appears in
the existing project activity stream without inventing an Agent run or broker. Automatic compaction
reuses its run's existing slot. Project close cancels and awaits starting runs, active runs, title
requests, and manual compactions.

On automatic compaction failure, Main logs the original error, persists a sanitized failure event,
keeps the last successful checkpoint, deterministically removes oldest complete turns and projects
older read/search output to safe typed facts, then continues with a non-blocking warning. Manual
failure or stop preserves the last successful checkpoint and releases its slot without starting an
Agent response. Provider context overflow is retried once only when the attempt has produced no
assistant text, tool activity, proposal, or other external side effect; overflow after activity ends
the run as `context_overflow_after_activity`, and a second pre-activity overflow ends it as
`context_overflow`.

At project-service startup, an unmatched `compaction_started` event is closed with
`compaction_failed(process_restarted)`; model work is never resumed.

## Consequences

Long conversations retain an auditable, gap-free model context while original history stays intact.
Concurrent title and compaction requests receive exact request correlation, and manual compaction
participates in the same bounded project capacity as Agent runs. Recovery is deterministic and does
not replay tool or manuscript side effects.

Event schema v3 and project migration 0027 are required. The Renderer gains manual compact/stop
controls and checkpoint activity/detail markers, but no new authority or direct database access.
