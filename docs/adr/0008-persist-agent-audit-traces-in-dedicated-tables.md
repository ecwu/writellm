---
id: ADR-0008
title: Persist agent audit traces in dedicated tables
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-008]
related_tasks: [PIA-005, PIA-006, PIA-009, PIA-011, PIA-012, DAT-001, REL-001]
depends_on: [ADR-0002]
external_task_gates: [DAT-001, REL-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0008: Persist agent audit traces in dedicated tables

## Context

Multi-step agent work needs durable, user-safe auditability across app restarts. Existing retrieval trace types and legacy generation rounds have different semantics and should not be overloaded to represent agent sessions, tool calls, cancellation, and terminal outcomes.

## Decision

Persist agent-specific records in dedicated workspace database tables for agent sessions, runs, events, and tool calls. Store redacted summaries, provenance references, budget/terminal metadata, and user-safe event details. Do not persist credentials, raw provider settings, hidden chain-of-thought, or unbounded source/tool payloads.

An in-flight MVP run is not resumable. On restart or workspace switch, it becomes terminal or canceled while completed trace data remains inspectable.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Reuse retrievalTrace or legacy generation rounds | Rejected because their lifecycle and data semantics do not represent a full agent audit trail. |
| Persist a raw model transcript | Rejected because it risks secret leakage, untrusted-source retention, and exposing hidden reasoning. |
| Keep all agent state in memory | Rejected because authors need inspection after restart and failures need diagnosis. |

## Consequences and constraints

- Schema and migration work must be compatible with existing workspaces and redact sensitive data at write time.
- UI events expose concise summaries rather than raw provider objects or unrestricted tool results.
- Future resumable sessions require a new ADR; they are not implied by persisted history.
- Migration and terminalization behavior must follow the accepted DAT-001 recovery policy and REL-001 lifecycle policy.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| DAT-001 | Define the migration, backup, reconciliation, and recovery policy required before agent-table migration. |
| REL-001 | Define the lifecycle policy for terminalizing in-flight state on workspace switch and shutdown. |
| PIA-005 | Define and migrate typed agent session, run, event, and tool-call records. |
| PIA-006 | Persist lifecycle and terminal-state updates from AgentManager. |
| PIA-009 | Define renderer-safe shared record and event types. |
| PIA-011 | Implement and test workspace-switch/shutdown terminalization and active-run safeguards. |
| PIA-012 | Test persistence, redaction, restart/closure terminalization, and list behavior. |

### Completion conditions

- [ ] Dedicated tables store sessions, runs, events, and tool calls separately from retrieval-only/legacy records.
- [ ] Every terminal run has redacted, ordered audit data available after restart.
- [ ] Tests prove no credentials or hidden reasoning are retained or exposed.
- [ ] Migration and terminalization evidence satisfies the accepted DAT-001 and REL-001 policies.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Formalized the PRD persistence model as an accepted architecture decision. |
