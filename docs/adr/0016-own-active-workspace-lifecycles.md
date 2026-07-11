---
id: ADR-0016
title: Own active workspace lifecycles centrally
date: 2026-07-11
initiative: REL
scope: project
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [REL-001, PIA-006, PIA-011, PIA-012]
depends_on: [ADR-0002, ADR-0008, ADR-0009]
external_task_gates: []
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0016: Own active workspace lifecycles centrally

## Context

Workspace switching currently stops ingest and the retrieval worker before opening a new database, but future/current asynchronous work can otherwise retain a reference to an old database. This risks a stale completion writing into a closed or replaced workspace. Pi requires equivalent cancellation, terminal inspection, and section-lock cleanup.

## Decision

Use one main-process lifecycle registry for work that can read/write an active workspace. A registration is keyed by workspace path and has an idempotent cancel operation plus an explicit completion signal. Workspace activation serializes transitions: cancel and drain registered work for the old workspace, stop owned workers, then close the old database and open the new one. App shutdown uses the same drain before closing the active database.

The current MVP permits one active workspace transition at a time. Existing legacy generation and retrieval operations register now; Pi AgentManager later registers runs and section locks under the same policy. In-flight work is canceled, not resumed. Completion code must observe cancellation and terminalize its own durable record before drain resolves; no stale operation may write after its workspace changes.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Let each feature cancel its own work during switch | It creates races and makes new Pi work easy to omit. |
| Close SQLite immediately and hope callers fail | Late failures lose terminal evidence and can corrupt UX. |
| Let in-flight work finish against the old workspace | Authors can switch intent and stale output can land in a closed/replaced workspace. |

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| REL-001 | Implement lifecycle registry, serialized workspace transition, legacy work registration, shutdown drain, and tests. |
| PIA-006 | Register AgentManager work under the same owner. |
| PIA-011 | Add Pi run/tool timeout, switch, shutdown, and lock cleanup. |
| PIA-012 | Prove no stale work writes across lifecycle boundaries. |

### Completion conditions

- [ ] A switch/shutdown cancels and drains registered active work before its database closes.
- [ ] A second workspace transition cannot interleave with the first.
- [ ] Existing legacy generation/retrieval terminalizes instead of writing stale state.
- [ ] Pi runs consume this registry and section locks release on every terminal path.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | REL-001 selected a central registration/drain policy for workspace switch and shutdown; legacy generation integration begins before Pi AgentManager adoption. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | Added central active-work registration, serialized workspace transitions, legacy generation/retrieval drain integration, shutdown drain, and deterministic lifecycle registry tests. Pi AgentManager remains required to register through the same policy. |
