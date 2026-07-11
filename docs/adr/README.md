# Architecture Decision Records (ADR)

This directory is the canonical architecture-decision register for the whole WriteLLM project. It captures durable choices, their rationale, their consequences, and whether the chosen design has actually been implemented.

The [master PRD](../project-prd.md) owns product requirements and the [project task tracker](../task-tracker.md) owns the exact task owner, task status, date, acceptance criteria, and implementation evidence. An ADR links to relevant task IDs and exposes an architecture-level implementation roll-up; it must not become a second, conflicting task board.

## When to create an ADR

Create an ADR when a choice materially affects one or more of:

- permission or trust boundaries;
- runtime, dependency, storage, or migration strategy;
- public IPC or user-visible workflow contracts;
- a decision that future implementation agents must not silently revisit.

Do not create an ADR for a routine code change that implements an already accepted decision. Update the linked task in the project task tracker instead.

## Status model

Every ADR has two independent fields so that an accepted decision is never mistaken for implemented code.

| Field | Allowed values | Meaning |
| --- | --- | --- |
| Decision status | PROPOSED, ACCEPTED, SUPERSEDED, ABANDONED | Whether the architecture choice is still under consideration, approved, replaced by a newer ADR, or no longer pursued. |
| Implementation status | NOT_STARTED, IN_PROGRESS, IMPLEMENTED, DEFERRED, ABANDONED, NOT_APPLICABLE | Whether the accepted design has no implementation work yet, is being implemented, has verified evidence, was intentionally postponed, was stopped, or needs no code change. |

The reader-facing combinations are:

| Display state | Meaning |
| --- | --- |
| ACCEPTED / NOT_STARTED | 已决策，待实施。 |
| ACCEPTED / IN_PROGRESS | 已决策，实施中。 |
| ACCEPTED / IMPLEMENTED | 已决策，已实施并有验证证据。 |
| PROPOSED / NOT_STARTED | 尚待验证或决策；不得假定为产品承诺。 |
| PROPOSED / IN_PROGRESS | 正在进行有边界的调研或技术验证；尚未采用该架构，也不得交付为产品能力。 |
| ABANDONED | 已放弃；保留记录和原因，不删除文件。 |
| SUPERSEDED | 已被另一份 ADR 替代；从本文件链接到替代记录。 |

Normal transitions are:

```text
PROPOSED → ACCEPTED → SUPERSEDED
    │           │
    └──────────→ ABANDONED

NOT_STARTED → IN_PROGRESS → IMPLEMENTED
     │              │
     └──────────────→ DEFERRED or ABANDONED
```

An implementation status changes only when the linked task-tracker state and evidence justify it. A code branch, compilation result, or partial experiment alone is not IMPLEMENTED.

A PROPOSED ADR may use IN_PROGRESS only while its explicitly scoped decision research or spike is active. It cannot become IMPLEMENTED until its decision status is ACCEPTED; an abandoned proposal records ABANDONED rather than leaving an ambiguous partial state.

## Working agreement for coding agents

Before changing architecture-affecting product code:

1. Read the master PRD, the global task tracker, the relevant initiative PRD when present, and this index.
2. Find the ADRs linked from the claimed task.
3. Claim and update the task only in the global task tracker.
4. If work starts, completes, defers, abandons, or changes the architecture represented by an ADR, update that ADR's implementation status and append a status-history entry in the same change. For a PROPOSED ADR, only bounded decision research may move to IN_PROGRESS.
5. If a new choice changes an ACCEPTED ADR, create a new ADR and mark the old one SUPERSEDED. Do not rewrite the historical decision.
6. Link verification evidence from the tracker task row or implementation change. Never put provider credentials, raw model reasoning, or unbounded source contents in an ADR.

For an ADR with several task IDs, the implementation status is a roll-up, not a duplicate per-task status:

- NOT_STARTED: no linked implementation task has begun.
- IN_PROGRESS: at least one linked task is active or in review; for a PROPOSED ADR, this describes research rather than adopted implementation.
- IMPLEMENTED: the ADR's stated completion conditions have evidence in the linked task records.
- DEFERRED or ABANDONED: the global tracker activity log explains why execution stopped.

## File convention

Use a zero-padded, permanent number and a short kebab-case title:

```text
NNNN-short-decision-title.md
```

Start from [TEMPLATE.md](TEMPLATE.md). IDs are never reused, including for abandoned decisions.

## Current index

The initial records below belong to the PIA initiative. New records may belong to any initiative prefix registered in the master PRD.

| ADR | Initiative | Decision | Decision status | Implementation status | Linked tasks |
| --- | --- | --- | --- | --- | --- |
| [ADR-0001](0001-use-pi-agent-core-as-controlled-writing-runtime.md) | PIA | Use Pi Agent Core as a separate controlled writing runtime | SUPERSEDED | ABANDONED | PIA-003, PIA-004, PIA-006 |
| [ADR-0002](0002-run-agent-only-in-electron-main-process.md) | PIA | Run the agent only in Electron main process | ACCEPTED | IN_PROGRESS | SEC-001, SEC-002, REL-001, PIA-006, PIA-009, PIA-011, PIA-012 |
| [ADR-0003](0003-preserve-human-reviewed-writingpatch-boundary.md) | PIA | Keep human-reviewed WritingPatch as the sole write boundary | ACCEPTED | IN_PROGRESS | PIA-008, PIA-010, PIA-012, PIA-013, PIA-014 |
| [ADR-0004](0004-limit-mvp-to-an-allowlisted-local-tool-facade.md) | PIA | Limit the MVP to scoped local tools and a review-only patch proposal | ACCEPTED | IN_PROGRESS | SEC-001, PIA-007, PIA-008, PIA-012, PIA-014 |
| [ADR-0005](0005-select-pi-model-adapter-strategy.md) | PIA | Select the Pi model-adapter strategy | ACCEPTED | IMPLEMENTED | SEC-003, PIA-004, PIA-006, PIA-012, PIA-018 |
| [ADR-0006](0006-select-supported-electron-pi-runtime-path.md) | PIA | Select the supported Electron/Pi runtime path | SUPERSEDED | ABANDONED | PIA-001, PIA-002, PIA-003, PIA-016 |
| [ADR-0007](0007-gate-agent-mode-with-a-local-feature-flag.md) | PIA | Gate a separate agent mode with a legacy fallback | SUPERSEDED | ABANDONED | PIA-001, PIA-010, PIA-016 |
| [ADR-0008](0008-persist-agent-audit-traces-in-dedicated-tables.md) | PIA | Persist redacted agent audit traces in dedicated tables | SUPERSEDED | ABANDONED | DAT-001, REL-001, PIA-005, PIA-006, PIA-009, PIA-011, PIA-012 |
| [ADR-0009](0009-use-section-level-agent-run-locks.md) | PIA | Use section-level locks for agent runs | ACCEPTED | IN_PROGRESS | REL-001, PIA-006, PIA-010, PIA-011, PIA-012 |
| [ADR-0010](0010-use-a-supported-patched-electron-runtime-for-pi.md) | PIA | Use a supported, patched Electron runtime for Pi | ACCEPTED | IMPLEMENTED | PIA-003, PIA-016, PIA-017 |
| [ADR-0011](0011-bound-generation-retrieval-worker-lifecycles.md) | GEN | Bound generation retrieval worker lifecycles | ACCEPTED | IMPLEMENTED | GEN-002 |
| [ADR-0012](0012-replace-interactive-generation-with-pi-agent-event-runtime.md) | PIA | Replace interactive generation with the Pi Agent event runtime | ACCEPTED | IN_PROGRESS | PIA-004 through PIA-016, PIA-018, GEN-002 |
| [ADR-0013](0013-harden-electron-renderer-and-ipc-boundaries.md) | SEC | Harden Electron renderer and IPC boundaries | ACCEPTED | IMPLEMENTED | SEC-001, SEC-002, SEC-003, PIA-007, PIA-009, PIA-012 |
| [ADR-0014](0014-store-provider-secrets-and-gate-outbound-data.md) | SEC | Store provider secrets securely and gate outbound data | SUPERSEDED | IMPLEMENTED | SEC-003, PIA-004, PIA-007, PIA-012 |
| [ADR-0015](0015-preserve-workspace-data-through-migrations-and-recovery.md) | DAT | Preserve workspace data through migrations and recovery | ACCEPTED | NOT_STARTED | DAT-001, DAT-002, PIA-005, PIA-016 |
| [ADR-0016](0016-own-active-workspace-lifecycles.md) | REL | Own active workspace lifecycles centrally | ACCEPTED | IMPLEMENTED | REL-001, PIA-006, PIA-011, PIA-012 |
| [ADR-0017](0017-expose-bounded-knowledge-retrieval-through-pi-tool.md) | PIA | Expose bounded knowledge retrieval through the Pi `source` tool | ACCEPTED | IN_PROGRESS | PIA-007, PIA-011, PIA-012, PIA-014, PIA-016, PIA-019 |
| [ADR-0018](0018-rebuild-llm-and-rag-on-pi-without-legacy-compatibility.md) | PIA | Rebuild LLM and RAG on Pi without legacy compatibility | ACCEPTED | IN_PROGRESS | PIA-004 through PIA-016 |
| [ADR-0019](0019-isolate-pi-retrieval-and-backpressure-live-events.md) | PIA | Isolate Pi retrieval and backpressure live events | ACCEPTED | IN_PROGRESS | PIA-006, PIA-007, PIA-009 through PIA-012, PER-001 |
| [ADR-0020](0020-limit-provider-secrets-to-the-privileged-backend.md) | SEC | Limit provider secrets to the privileged backend | ACCEPTED | IN_PROGRESS | SEC-003, SEC-004, PIA-004, PIA-007, PIA-012 |
| [ADR-0021](0021-open-focused-sections-in-markdown.md) | DOC | Open focused sections directly in Markdown | ACCEPTED | IMPLEMENTED | DOC-002 |
| [ADR-0022](0022-store-manuscript-as-block-document.md) | DOC | Store the manuscript as one block document with logical section ranges | ACCEPTED | IN_PROGRESS | DOC-003 |
