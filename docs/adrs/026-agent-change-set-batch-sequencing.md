# ADR 026: Agent Change-Set Batch Sequencing And Recovery

Status: accepted for Checkpoint 35B; implementation authorized
Date: 2026-08-13

## Context

Checkpoint 35A reconstructs a read-only task-wide view from ordinary Agent proposal rows. Authors
now need to decide several selected proposals without weakening the exact authorization,
precondition, stale-refresh, generation, revision, and Undo rules already owned by each proposal
kind. Those effects span Brief, outline, section revisions, immutable assets, optional external
image generation, editor barriers, materialization, and project history. They cannot honestly be
presented as one atomic database transaction.

The operation must also survive an unobserved response or process exit between individual
decisions. Re-running an applied proposal is not valid, and keeping only Renderer state cannot
distinguish “not attempted” from “effect committed, receipt not yet advanced.”

## Decision

### 1. Main sequences existing decisions; proposal rows remain authoritative

A selected batch contains 1–100 unique pending proposals from exactly one active conversation and
one immutable writing-task ID. Main validates that ownership before any decision. Every item calls
the existing `MutationProposalService.approve` or `reject` entry point and therefore retains the
same editor flush, sender/session authorization, exact base checks, ADR 003 refresh, image
generation, canonical revision, materialization, Review Issue, and event-publication behavior.

There is no batch apply transaction and no copied proposal/effect table. Applied earlier items are
not rolled back when a later item stops. The result always reports processed and unattempted items
separately.

### 2. Dependency order is deterministic and conservative

Main ignores Renderer ordering and sorts selected proposals by authority:

1. Brief and Writing Rules;
2. outline;
3. section body;
4. generated-image insertion.

Within one authority class, creation time and proposal ID are the stable tie breakers. This places
outline changes before body effects that may depend on section identity and keeps multiple
proposals for one section in their original order. Each item still revalidates its own exact base;
the first applied proposal may correctly make a later proposal stale.

### 3. Refresh, conflict, and failure stop the sequence

`applied`, `already_satisfied`, and explicit rejection advance the command. A refresh-required
result persists the replacement through ADR 003 but does not approve it: the replacement remains a
new pending proposal requiring individual review. Refresh-required, explicit conflict, image
generation failure, validation failure, or another item error stops before the next item. The UI
reports every remaining selection as not attempted. After resolving the blocking item, the author
may create a new batch for remaining pending proposals and Resume the same ordinary writing task.

Request changes remains an individual normal proposal rejection/continuation because it starts the
ordinary Agent loop with item-specific feedback. Batch rejection records one explicit bounded
reason on each selected item and does not start model work.

### 4. One narrow durable command receipt closes the crash window

Migration 0032 adds `agent_change_set_commands`, scoped by command UUID, writing task, and Agent
conversation. It stores a request fingerprint, dependency-ordered proposal IDs, optional rejection
reason, checkpoint state, next index, bounded per-item result JSON, and lifecycle status. It is a
command receipt and recovery cursor, not proposal or manuscript authority.

The receipt is inserted before a checkpoint or proposal effect. After each item, Main ensures the
ordinary approval-decision event exists and then atomically advances the cursor/result. Retrying
the same command UUID with a different fingerprint fails. A completed or stopped command returns
its stored result. A `prepared` or `running` command resumes at its cursor.

If a process exits after a proposal effect commits but before the cursor advances, recovery reads
the current authoritative proposal status. `applied`, `satisfied`, or `rejected` is reconciled
without repeating the mutation; a superseded proposal resolves to its current refresh-chain leaf
and stops for review. The approval-decision event is deduplicated by proposal and decision before
the cursor advances. Generating/failed image state stops safely rather than replaying an external
generation request.

### 5. Optional version history is explicit and never auto-enabled

When requested, the durable receipt precedes inspection of managed history. Ready history receives
one pre-change checkpoint through the existing Project Manager snapshot barrier. Uninitialized or
damaged history is reported as unavailable and the batch may proceed. A checkpoint creation error
is logged with the original error, recorded as failed, and stops before any proposal is attempted.
The operation never enables or repairs history automatically.

### 6. Post-application review is deterministic

The result reconciles every selected ID against current proposal authority and reports applied,
satisfied, rejected, adverse, processed, and remaining counts. `reconciled` is true only when the
whole selection reached a non-adverse terminal result. The passive UI refreshes manuscript and
task projections after the command. Deeper manuscript review remains the ordinary Agent's
`check_draft` fixture and Review Center path; the batch protocol does not start a special model
review.

## Consequences

Checkpoint 35B adds one project migration, one bounded service, one sender-authorized IPC method,
and shadcn selection/result controls in the existing task change set. It adds no provider SDK,
dependency, worker, background Agent, conversation type, scheduler, generic transaction
coordinator, or direct Renderer authority. Command rows naturally participate in project backup,
snapshot, clone, and version-history restore with the project database.
