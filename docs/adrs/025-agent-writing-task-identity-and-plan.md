# ADR 025: Agent Writing-Task Identity And Plan Model

Status: accepted for Checkpoints 34A, 34B, and 35A; implementation authorized
Date: 2026-08-13

## Context

WriteLLM already has durable Agent conversations, runs, events, proposals, and project-level work
reservations. A long cross-section request can span retries, review continuations, project
close/reopen, and application restart, but today it has no explicit identity or bounded plan. Event
order and assistant prose cannot safely define that boundary: concurrent conversations, retries,
plan revision, and rolling context checkpoints make those inferences ambiguous.

The task plan is collaboration state around the existing ordinary Agent loop. It must not become a
scheduler, mutation authority, background Agent job, second conversation type, or source of truth
for manuscript effects.

## Decision

### 1. One durable writing task may belong to one Agent conversation

Main allocates an opaque UUID task ID when the ordinary Agent calls `create_writing_task`. A task is
project-local, belongs to exactly one `agent_session`, and survives archive/restore, project
close/reopen, and application restart for the lifetime of that conversation. One conversation may
have at most one task. A task cannot move between conversations or projects, and deleting its
conversation cascades the task.

The task stores one human-readable objective of at most 4,096 characters. Objective and plan text
are private project content and are never written to logs.

### 2. The current plan uses stable step IDs and optimistic monotonic versions

The current plan is a strict versioned payload with schema version 1 and between 1 and 32 ordered
steps. Main allocates opaque UUID step IDs for new steps. A step has a title of at most 500
characters and one of these states:

- `pending`: planned but not currently being worked;
- `active`: the single current step;
- `completed`: the Agent reports the collaboration step finished, subject to CP34B reconciliation;
- `skipped`: intentionally omitted with a bounded reason;
- `blocked`: cannot proceed, with a bounded reason.

Exactly one non-terminal step is active. A plan may be entirely terminal. Completed and skipped
steps never return to a non-terminal state. A blocked step may become active or skipped. Plan
revision preserves IDs for retained steps, allocates IDs for additions, and rejects unknown,
duplicate, or foreign IDs.

Plan version begins at 1 and increases by exactly one in the same SQLite transaction as every
accepted change. Every mutation supplies the exact current version; stale writers fail. The task ID
and step IDs never change across plan versions.

### 3. One narrow table stores current task authority

Project SQLite adds one `agent_writing_tasks` table with task ID, unique conversation ID,
objective, current plan version, bounded validated plan JSON, and timestamps. This is the smallest
new authority needed to load the current task without inferring it from event order.

Ordinary task-tool call and result events carry the exact task ID, plan version, affected step IDs,
and resulting bounded plan. The current task table, rather than event order, owns identity and the
current version. CP34A does not add a second task event table or a new Agent event type. CP34B user
edits use the same optimistic service and current table; task history is not manuscript recovery
state.

### 4. Task operations are ordinary bounded Agent fixture tools

The ordinary Agent receives parallel `get_writing_task` and sequential `create_writing_task` /
`update_writing_task` fixture tools. Creating a task requires an objective and ordered step titles.
Updating uses typed operations to revise the objective, add or retitle steps, reorder steps, and
transition step state. Main validates the conversation/run, optimistic plan version, state machine,
one-active-step invariant, and all bounds.

These tools mutate collaboration metadata only. They cannot start a model request, schedule a run,
change manuscript data, decide a proposal, or bypass project-level Agent reservations. Static
application policy tells the Agent to create a task only for genuinely multi-step cross-section
work, keep the plan concise, update it before changing phases, and never claim authoritative
manuscript success from plan state.

### 5. Exact task and step correlation is captured at effect boundaries

Task-tool events carry their exact task and affected step IDs. After task creation, proposal
creation snapshots the conversation's current task ID and active step ID onto the existing proposal
row. This immutable correlation lets CP35 group proposals without deriving identity from narration
or event order. A proposal created with no active task step remains unscoped.

CP34B snapshots the current task and active step onto each later ordinary Agent run; the run that
creates the task is correlated in the same task-creation transaction. It projects progress from
those exact run identities and correlated proposal status. Authoritative proposal, revision, and
model-request rows continue to decide whether manuscript work actually happened. Plan `completed`
is therefore only reported collaboration intent until reconciliation confirms the corresponding
effects. Pending review, stopped and failed runs, verified effects, report-only completion, and
plan/effect disagreement are explicit derived presentation states. Disagreement is shown, never
silently overwritten.

### 6. The Renderer is a passive projection

CP34A exposes bounded Main-owned read results through the existing session response. CP34B adds
plan display and optimistic idle user editing inside the existing conversation canvas. Resume is a
Main-authored request sent to the same ordinary conversation and requires the Agent to reread the
current task before continuing. The Renderer never
allocates durable IDs, writes SQLite, starts a separate model flow, or treats plan state as
manuscript authority.

### 7. A read-only change set is a deterministic task projection

Checkpoint 35A groups existing proposal rows only when their immutable `writing_task_id` equals
the conversation's current task ID. It orders proposals by creation time and proposal ID, groups
brief and outline effects separately and body/image effects by exact affected section, and reports
every authoritative status independently. Refresh chains remain visible as history; navigation
from any ancestor resolves to the latest known replacement and returns to the ordinary exact
proposal review surface.

The projection recomputes after project open, switch, restart, plan revision, and concurrent
conversation activity. Pending section and generated-image proposals compare their stored base
revision with the current section revision and display ADR 003's refresh-required state. The
Renderer may render the already persisted bounded before/after preview inside the group, but it
cannot decide, refresh, apply, or rebase a proposal from that projection.

## Consequences

Agent Harness Protocol v6 adds three bounded task fixture tools. Project migration 0030 adds the
single task table and nullable immutable task/step correlation columns on existing proposal rows.
No Agent event-schema change, dependency, worker, job type, scheduler, subagent, provider runtime,
or conversation type is introduced.

Project migration 0031 adds nullable task/step correlation to `agent_runs`; it does not add a table,
worker, job, scheduler, or event type. Task state participates in project backups, snapshots, history restore, clone sanitization, and
portability because it is authoritative project collaboration metadata. It never enters
`app.sqlite` and is never reconstructed from logs or assistant prose.

Checkpoint 35A adds no migration, table, IPC authority, dependency, model call, job, or worker. Its
change-set identity is the existing task ID, and `mutation_proposals` remains the sole decision and
effect authority.
