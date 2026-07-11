---
id: ADR-0009
title: Use section-level locks for agent runs
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-009]
related_tasks: [REL-001, PIA-006, PIA-010, PIA-011, PIA-012]
depends_on: [ADR-0002, ADR-0008]
external_task_gates: [REL-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0009: Use section-level locks for agent runs

## Context

Agent output produces a patch against section Markdown and anchors. A full-section run and a selected-text run for the same section can race, generate stale proposals, or make an author misinterpret which revision is current. The product also needs a single lock rule that applies to UI start, steering, retry, cancellation, workspace switch, and persisted terminal state.

## Decision

Use an active-run lock keyed by the active workspace and parent section ID. The MVP permits at most one active agent run for a section, whether it began from the whole section or a selected range. A selected range always carries the parent section ID.

A request for a second run for the same section returns a typed conflict or uses steer/follow-up on the existing run. The MVP does not promise parallel work across different sections; the project-wide REL-001 lifecycle policy may impose a stricter workspace-level limit.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Lock by selected range only | Rejected because overlapping/changed ranges in the same Markdown section still race at the patch boundary. |
| Allow unlimited concurrent section runs | Rejected because it makes section anchors, review state, and terminalization unsafe in the MVP. |
| Lock the entire workspace permanently | More restrictive than necessary; REL-001 may choose it as a temporary operational limit, but it is not the product identity key for agent conflict detection. |

## Consequences and constraints

- AgentManager must acquire and release the section lock across all terminal paths.
- Patch validation remains the final stale-content safeguard; locking reduces rather than replaces it.
- Workspace switch and shutdown terminalize affected runs and release their locks according to REL-001.
- UI status, cancellation, retry, steer, and follow-up behavior must use the same parent-section identity.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| REL-001 | Define shared lifecycle/concurrency policy and any temporary workspace-level limit. |
| PIA-006 | Register and manage the active workspace/section lock in AgentManager. |
| PIA-010 | Present section-level busy, steer, follow-up, and duplicate-start states clearly. |
| PIA-011 | Implement switch/shutdown/timeout/retry cleanup and duplicate-start handling. |
| PIA-012 | Test whole-section versus selection conflicts, lock release, and stale-patch behavior. |

### Completion conditions

- [ ] Start, steer, follow-up, retry, cancel, and terminalization use one workspace/section lock identity.
- [ ] A second run for the same section cannot create a competing active run.
- [ ] Tests cover full-section/selection conflict, workspace switch, cancellation, and lock release.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Formalized the section-level concurrency key for the accepted MVP scope. |
