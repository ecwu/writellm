# ADR 004: Agent Approval Policy And Model Limits

Status: accepted; approval-waiter and YOLO semantics superseded by ADR 005; Renderer model-catalog statement superseded by ADR 008; per-mode automatic-application limits superseded by ADR 043
Date: 2026-07-22

## Decision

Agent proposal decisions use one of three run-snapshotted modes: `manual`, `section_auto`, or
`yolo`. The application stores the default, each project-local Agent session stores its selected
mode, and a run snapshots the mode before execution. `manual` is the default. Brief and Outline
proposal tools in every non-YOLO run do not return to Pi until the user approves or rejects the
proposal. Automatic application never bypasses the existing proposal transaction or revision
checks.

A stale Section proposal is still never applied directly. In an automatic mode, Main may perform
the existing operation-aware refresh once and immediately approve the fresh replacement when it
remains exact and non-conflicting. Manual mode continues to require separate review of the
replacement. Conflicts and a second stale race return safely to the Agent.

Agent context limits are snapshotted per run. Main resolves a bounded record from a manual override,
an exact models.dev catalog match/cache, or the legacy 131,072-token fallback. The same record drives
Pi's model description, output and history budgets, compaction, persistence, and renderer context
utilization. models.dev is an optional fixed-host metadata source, not an online run dependency.

## Consequences

The seven-tool boundary and five Agent persistence tables remain unchanged. Approval waiters are
request-scoped memory and are cancelled with the run; proposal rows remain durable. Existing
sessions/runs migrate to `manual` and legacy limits. The renderer receives only validated settings,
resolved limit metadata, and proposal lifecycle notifications, never a raw catalog or network
capability.
