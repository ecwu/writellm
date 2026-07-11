---
id: ADR-0005
title: Select the Pi model adapter strategy
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-005]
related_tasks: [PIA-004, PIA-006, PIA-012, SEC-003]
depends_on: [ADR-0001, ADR-0006]
external_task_gates: [SEC-003]
supersedes: []
superseded_by: null
decision_status: PROPOSED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0005: Select the Pi model adapter strategy

## Context

WriteLLM currently uses the Vercel AI SDK for configurable one-shot generation. Agent mode additionally needs reliable tool calls, cancellation, token/output limits, stream events, capability preflight, and deterministic fakes. These constraints must work with supported user-configured endpoints without altering the existing quick-generation path.

## Decision

No implementation strategy has been selected. PIA-004 must compare and prove one of these options:

1. Map WriteLLM settings to Pi's native AI provider/model configuration.
2. Retain Vercel AI SDK transport and provide a custom Pi stream/model adapter.

The selected option becomes ACCEPTED only after a focused proof can complete one bounded tool-call round with cancellation and a deterministic fake.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Native Pi AI adapter | May reduce translation code; must preserve endpoint compatibility and testability. |
| Custom Vercel AI stream adapter | May preserve current provider handling; must faithfully implement Pi's stream and tool-call contract. |
| Migrate all existing generation to Pi | Rejected for this decision because it expands the initiative and risks stable quick actions. |

## Consequences and constraints

- The adapter is the only boundary allowed to depend on Pi version-specific message and event types.
- Unsupported model/tool-calling capability is detected before a costly run starts.
- Existing Vercel AI SDK quick actions are not migrated as a side effect.
- Provider calls, credentials, redaction, consent, and local-only behavior must conform to the accepted SEC-003 policy.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-003 | Establish secret storage and outbound-data policy that bounds adapter/provider behavior. |
| PIA-004 | Build the decision spike and record proof, provider behavior, and selected option. |
| PIA-006 | Consume the selected adapter through AgentManager. |
| PIA-012 | Provide deterministic tests without live provider credentials. |

### Completion conditions

- [ ] PIA-004 contains an explicit accepted or abandoned outcome with comparison evidence.
- [ ] The chosen adapter supports one bounded tool-call round, cancellation, limits, and a test double.
- [ ] Tracker evidence and this ADR decision/implementation status are updated together.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | PROPOSED | NOT_STARTED | Migrated pending PRD decision PIA-D-005 into the ADR register; PIA-004 owns the proof. |
