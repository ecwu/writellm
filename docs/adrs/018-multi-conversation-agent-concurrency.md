# ADR 018: Multi-Conversation Agent Concurrency

Status: accepted for Checkpoint 28.4; amended by ADR 019 for Checkpoint 28.5
Date: 2026-08-12

## Context

Agent persistence and protocol envelopes already isolate work by `agentSessionId`, `agentRunId`,
`modelRequestId`, and the revocable `projectSessionId` capability. The remaining single-run limit
comes from application-level mutexes in Main, the agent worker, and the Renderer. That prevents a
writer from continuing in another conversation while a long Agent turn is preparing, using tools,
or waiting on a model.

Removing every mutex without a replacement would allow click races, duplicate turns in one
conversation, and unbounded provider or memory pressure. Adding a queue, durable job, or worker per
run would introduce lifecycle and recovery machinery that is unnecessary for the bounded desktop
use case.

## Decision

Allow at most three active Agent work reservations per open project, with at most one reservation
in any Agent conversation. A reservation is either an Agent run or a request-scoped manual context
compaction. The fixed limit includes slot reservation, provider and Writing Skill preparation,
automatic context compaction, model calls, tool loops, manual compaction, and terminal settlement.
Automatic compaction reuses the reservation already held by its run. Main reserves a slot
synchronously before the first asynchronous preparation step and releases only the matching work
item's slot. A fourth item is rejected rather than queued. See ADR 019.

Main indexes starting and active runs by run ID and conversation ID and active manual compactions
by compaction ID. Stop, steering, follow-up, model-call authorization, tool handling, and event
settlement remain capability-bound to the exact work item. Project close cancels and awaits every
starting run, active run, title request, and manual compaction. Relaunch recovery marks persisted
`running` rows interrupted and unmatched compaction starts failed without resuming model work.

Keep one `agent-worker` process. It may host up to three isolated Pi session loops, each with its
own controller, request state, tool `MessagePort`, and run capabilities. A targeted cancellation
affects only its matching loop; worker exit or a process-level protocol violation rejects all
requests owned by that worker.

Add a project-scoped activity subscription constrained by `projectSessionId`. Main installs its
bounded event queue before reading `AgentProjectActivitySnapshot`, then explicitly switches the
subscription to live delivery. The snapshot contains the fixed limit, active count, and no more
than three live-run records with bounded partial UTF-8 output plus no more than three manual
compaction records. `activeCount` is the sum of both arrays. Durable conversation history remains on
the existing paginated conversation API.

Renderer keeps draft and bounded streaming state per conversation. Conversation switching does not
cancel background work. The current conversation controls only its own Queue, Steer, and Stop.
When all slots are occupied, only starting a new run is disabled; drafts, switching, and controls
for existing runs remain available.

Concurrent turns retain the manuscript snapshot captured at run creation. Existing proposal,
revision, brief-version, and outline-version compare-and-swap checks remain authoritative. This
checkpoint does not add a database migration, durable job, worker type, extra process, configurable
limit, or in-memory request queue.

## Consequences

Independent conversations can make progress concurrently with bounded resource use. Duplicate
turns in one conversation and the project-wide 3+1 case fail immediately with explicit messages.
Live state survives conversation switches without duplicate replay or lost snapshot-race events.

The single worker remains a shared failure domain, while individual run errors and cancellations
are isolated. Competing proposals against the same manuscript version still cannot both commit;
one succeeds and the other follows the existing stale/conflict and refresh path.
