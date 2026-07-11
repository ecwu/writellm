---
id: ADR-0007
title: Gate agent mode with a local feature flag
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-007]
related_tasks: [PIA-001, PIA-010, PIA-016]
depends_on: [ADR-0010]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0007: Gate agent mode with a local feature flag

## Context

Agent mode introduces a new runtime, dependency, persistence model, and author workflow. A safe rollout needs a reversible way to stop new runs without damaging existing quick-generation actions or deleting already stored audit history.

## Decision

Protect agent mode with a local, default-off feature flag. When disabled, the application does not expose or start new agent runs, but retains readable historical traces and leaves all legacy generation behavior unchanged.

The flag is persisted as `agent.enabled` in the existing local `writellm-settings.json` user-data file and defaults to `false` when absent. Its parser must tolerate a missing or non-boolean value by resolving to `false`. The main-process run-start boundary enforces the flag; renderer state only reports availability and cannot bypass it. This local field does not include credentials or create a remote control plane.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Ship agent mode permanently enabled | Rejected because it lacks a safe rollback path during a staged release. |
| Delete agent records when disabling | Rejected because it harms auditability and prevents diagnosis. |
| Use a remote feature-flag service in the MVP | Rejected because it adds a network, privacy, and operations surface unrelated to the local desktop product. |

## Consequences and constraints

- Disabling the flag prevents new runs at the main-process start boundary, not only by hiding UI.
- The renderer reflects disabled status clearly but is not the authority for enforcement.
- Rollback evidence must prove that legacy generation remains available and historical traces remain readable.
- The initial compatible-runtime rollout ships with the flag false. PIA-016 must rehearse disabling it after an enabled run and prove that no new run starts after restart while historical records and quick generation remain readable.

## Linked implementation work

| PIA task | Contribution to this decision |
| --- | --- |
| PIA-001 | Specify the flag's storage, default, rollout, and rollback plan with the runtime decision. |
| PIA-010 | Represent availability and disabled state in the author-facing UI. |
| PIA-016 | Implement and rehearse safe enable/disable and rollback behavior. |

### Completion conditions

- [ ] Main-process start requests reject new runs when the local flag is disabled.
- [ ] Disabled UI does not obscure historical agent traces or legacy generation actions.
- [ ] A rollback rehearsal records the flag behavior and recovery evidence.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Formalized PRD feature-flag requirement PIA-FR-014 as an accepted architecture decision. |
| 2026-07-11 | ACCEPTED | NOT_STARTED | PIA-001 selected local `agent.enabled`, default false, in the existing user-data settings file; main-process enforcement and rollback rehearsal remain implementation work. |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Updated the runtime dependency to ADR-0010 after ADR-0006 was superseded; feature-flag policy and implementation scope are unchanged. |
