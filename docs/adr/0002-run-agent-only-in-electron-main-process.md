---
id: ADR-0002
title: Run the agent only in the Electron main process
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-002]
related_tasks: [PIA-006, PIA-009, PIA-011, PIA-012, SEC-001, SEC-002, REL-001]
depends_on: [ADR-0001]
external_task_gates: [SEC-001, SEC-002, REL-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0002: Run the agent only in the Electron main process

## Context

The renderer is an untrusted presentation layer. Provider credentials, SQLite access, Git-backed workspace services, cancellation ownership, and lifecycle cleanup already belong in Electron main. Direct renderer access to an agent runtime would widen the attack surface and bypass the existing typed IPC boundary.

## Decision

Create and run Pi Agent Core only in Electron main. The renderer communicates through typed IPC requests and receives only UI-safe event summaries, patch-review data, and typed errors.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Run Pi in the renderer | Rejected because it risks exposing credentials and privileged services to UI code. |
| Expose raw main-process services through preload | Rejected because it bypasses narrow IPC contracts and scope checks. |
| Run one unscoped process per renderer action | Rejected because lifecycle, cancellation, and workspace-switch ownership would be unclear. |

## Consequences and constraints

- Renderer code must never import Pi or hold model/provider credentials.
- New agent channels are added consistently in src/shared/ipc.ts, src/preload/preload.cts, and src/renderer/api.ts.
- AgentManager owns active-run registration, AbortSignal propagation, shutdown, and workspace-switch cleanup within the shared lifecycle policy.
- Events must redact provider internals, secrets, and hidden reasoning.
- SEC-001, SEC-002, and REL-001 define the project-wide security and lifecycle gates; this ADR does not create an agent-specific bypass or competing policy.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-001 | Define the desktop threat model that bounds the agent's main-process and preload access. |
| SEC-002 | Implement the IPC hardening required before exposing agent channels. |
| REL-001 | Define the shared workspace/shutdown/concurrency policy consumed by AgentManager. |
| PIA-006 | Implement main-process lifecycle ownership in AgentManager. |
| PIA-009 | Add typed, renderer-safe IPC contracts for commands and events. |
| PIA-011 | Stop scoped runs safely on timeout, workspace switch, and shutdown. |
| PIA-012 | Test that renderer-facing contracts cannot bypass main-process safeguards. |

### Completion conditions

- [ ] Pi runs and credentials are reachable only from main-process agent modules.
- [ ] Every renderer interaction uses a typed IPC channel with a UI-safe payload.
- [ ] Lifecycle tests cover cancellation and workspace closure without an orphaned run.
- [ ] Agent behavior conforms to the accepted SEC and REL task evidence rather than bypassing it.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Migrated accepted PRD decision PIA-D-002 into the ADR register. |
