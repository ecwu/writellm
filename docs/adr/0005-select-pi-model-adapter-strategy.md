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
related_tasks: [PIA-004, PIA-006, PIA-012, PIA-018, SEC-003]
depends_on: [ADR-0010, ADR-0012]
external_task_gates: [SEC-003]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0005: Select the Pi model adapter strategy

## Context

WriteLLM currently uses the Vercel AI SDK for configurable one-shot generation. Under ADR-0012, every interactive generation action will move to Pi. The adapter additionally needs reliable tool calls, cancellation, token/output limits, stream events, capability preflight, and deterministic fakes. These constraints must work with supported user-configured endpoints across the full replacement scope.

## Decision

Use Pi AI's native `openai-completions` stream implementation directly from the Pi Agent adapter. The adapter maps the main-process model settings to a Pi `Model`, provides the main-process API key only for the configured Pi provider, enforces outbound-data preflight, and caps output tokens. It uses no Vercel AI SDK transport or generation fallback.

The initial clean-slate model contract supports OpenAI-compatible endpoints, including DeepSeek's compatible endpoint. Unsupported endpoints fail preflight before a run begins. Additional provider protocols require an explicit adapter extension and deterministic proof.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Native Pi AI adapter | Selected: it supplies Pi's own model/stream types and a deterministic fake path without a transport translation layer. |
| Custom Vercel AI stream adapter | Rejected: ADR-0018 removes Vercel AI SDK from interactive generation and does not retain compatibility transport. |
| Retain a legacy generator for incompatible actions | Rejected by ADR-0012: the adapter proof must either support an action shape or produce a preflight failure; it may not keep a parallel active runtime. |

## Consequences and constraints

- The adapter is the only boundary allowed to depend on Pi version-specific message and event types.
- Unsupported model/tool-calling capability is detected before a costly run starts.
- The selected adapter must cover continue, rewrite-section, and replace-selection through one Pi patch-proposal contract; legacy quick actions are deleted by the ADR-0018 cutover.
- Provider calls, credentials, redaction, consent, and local-only behavior must conform to the accepted SEC-003 policy.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-003 | Establish secret storage and outbound-data policy that bounds adapter/provider behavior. |
| PIA-004 | Build the decision spike and record proof, provider behavior, and selected option. |
| PIA-006 | Consume the selected adapter through AgentManager. |
| PIA-012 | Provide deterministic tests without live provider credentials. |

### Completion conditions

- [x] PIA-004 contains an explicit accepted outcome with comparison evidence.
- [x] The chosen adapter supports a bounded tool-call round, cancellation, limits, and a deterministic fake.
- [ ] Tracker evidence and this ADR decision/implementation status are updated together.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | PROPOSED | NOT_STARTED | Migrated pending PRD decision PIA-D-005 into the ADR register; PIA-004 owns the proof. |
| 2026-07-11 | PROPOSED | NOT_STARTED | ADR-0012 changed the adapter's scope from an optional agent mode to every interactive generation action. The provider/stream strategy remains an unselected PIA-004 decision. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | ADR-0018 selected a clean-slate Pi-native adapter. `src/main/agent/modelAdapter.ts` maps OpenAI-compatible settings to Pi AI's native stream and has a provider-free Agent tool-call proof; AgentManager cancellation remains PIA-006 work. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | PIA-004 completed the adapter: deterministic faux-provider tests prove one sequential tool-call round, output cap, consent/capability preflight, and Pi `Agent.abort()` propagation. AgentManager lifecycle ownership remains PIA-006. |
