---
id: ADR-0001
title: Use Pi Agent Core as the controlled writing runtime
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-001]
related_tasks: [PIA-003, PIA-004, PIA-006]
depends_on: [ADR-0010]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0001: Use Pi Agent Core as the controlled writing runtime

## Context

WriteLLM needs a multi-turn, tool-calling loop for research-intensive writing workflows. Its existing generation flow is intentionally one-shot and safe, but does not own a reusable agent lifecycle. Pi is TypeScript-native and provides an embeddable agent core.

The Pi coding-agent CLI includes terminal-oriented behavior and is not an appropriate permission model for a writing application.

## Decision

Use @earendil-works/pi-agent-core as an internal orchestration dependency. Do not embed the Pi coding-agent CLI, terminal UI, default computer tools, or dynamic extension loader.

WriteLLM remains responsible for its own permissions, persistence, tool registry, document validation, and author approval workflow.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Continue hand-writing each multi-step workflow | Retains safety but duplicates orchestration, tracing, cancellation, and tool-loop logic for every workflow. |
| Embed the Pi coding-agent CLI | Rejected because its terminal-oriented capabilities exceed the product's writing scope. |
| Build a new agent loop from scratch | Possible later, but delays a bounded vertical slice without a clear advantage over Pi Agent Core. |

## Consequences and constraints

- Pi imports stay behind the local main-process adapter boundary.
- No Pi-provided tool becomes available unless WriteLLM explicitly registers a scoped replacement.
- Pi dependency versioning follows ADR-0010's supported Electron/Node runtime decision.
- Existing quick-generation actions continue to use their current path.

### Dependency evidence

PIA-003 pins `@earendil-works/pi-agent-core` at `0.80.3`. The lockfile resolves its direct `@earendil-works/pi-ai@^0.80.3` range to `0.80.6`; Core's other declared direct dependencies are `ignore@7.0.5`, `typebox@1.1.38`, and `yaml@2.9.0`. The resolved Pi closure added 77 packages, including provider SDKs for Anthropic, Bedrock, Google, Mistral, and OpenAI. The package's coding-agent sibling and deprecated `@mariozechner/*` packages are absent from both manifest and lockfile.

Electron main-process Node (`40.10.5` / `24.15.0`) imports `Agent` from the exact Core package successfully. Bun kept lifecycle scripts for `@google/genai` and `protobufjs` blocked; no trust override was used. The post-install audit removed the direct Electron finding but still reports 30 existing/shared dependency findings (5 high); QAL-001 owns their triage and release-gate evidence. This does not authorize model requests, Pi tools, resource loaders, extensions, or skills.

## Linked implementation work

Task state, owner, and evidence are canonical in the project task tracker.

| PIA task | Contribution to this decision |
| --- | --- |
| PIA-003 | Add one exact, reviewed Pi Agent Core dependency after runtime compatibility is proven. |
| PIA-004 | Prove a supported model/stream adapter can drive a bounded tool-call round. |
| PIA-006 | Use Pi only through AgentManager, not through application-wide direct imports. |

### Completion conditions

- [x] Reviewed, exact Pi Agent Core `0.80.3` builds and loads in Electron `40.10.5` main-process Node `24.15.0`.
- [ ] Pi-specific types and lifecycle calls are isolated in src/main/agent.
- [x] No Pi coding-agent CLI, deprecated Pi package, built-in privileged tool, or extension loader is installed or invoked.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Migrated accepted PRD decision PIA-D-001 into the ADR register; implementation is blocked by ADR-0006. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-002 completed the compatible Electron upgrade and PIA-003 began the exact Pi Core dependency review. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-017 replaced the superseded runtime with verified Electron 40.10.5 / Node 24.15.0; PIA-003 resumed final Pi Core dependency evidence. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-003 completed exact Core 0.80.3 installation, lock review, prohibited-component check, Electron-main import, unit tests, typecheck, build, and smoke. Adapter isolation, policy, and lifecycle implementation remain with PIA-004/PIA-006. |
