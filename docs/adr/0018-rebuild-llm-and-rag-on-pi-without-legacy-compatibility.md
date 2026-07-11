---
id: ADR-0018
title: Rebuild LLM and RAG on Pi without legacy compatibility
date: 2026-07-11
initiative: PIA
scope: project
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-005, PIA-D-008, PIA-D-010]
related_tasks: [PIA-004, PIA-005, PIA-006, PIA-007, PIA-008, PIA-009, PIA-010, PIA-011, PIA-012, PIA-013, PIA-014, PIA-015, PIA-016]
depends_on: [ADR-0003, ADR-0004, ADR-0010, ADR-0014, ADR-0016, ADR-0017]
external_task_gates: [SEC-003, REL-001]
supersedes: [ADR-0008]
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0018: Rebuild LLM and RAG on Pi without legacy compatibility

## Context

The current LLM path is a hand-written sequence of retrieval planning, optional Source v2 loops, worker retrieval, one-shot Vercel AI SDK generation, generation rounds, and an independently reconstructed renderer timeline. It cannot distinguish a slow embedding operation from a reranker or Source v2 evaluator before the outer retrieval deadline terminates the worker.

The author has explicitly authorized a clean-slate replacement. Historical LLM runs, legacy generation patches, compatibility IPC, and old runtime behavior need not be preserved. Already indexed source documents must remain usable: their source records, chunks, vector rows, FTS rows, import assets, and source provenance are product data rather than LLM history.

## Decision

Replace the complete interactive LLM and RAG execution stack with a Pi Agent Core implementation in Electron main. Pi `Agent` owns every interactive writing action; no Vercel AI SDK generation, retrieval planner, Source v2 evaluator, legacy generation round, or compatibility route remains active.

`continue`, `rewrite section`, and `replace selection` become one scoped agent-run contract. Each run starts with a focused section snapshot and optional selection, may use the bounded `source` RAG tool, and can only return a typed patch proposal for the existing author-review boundary. It does not directly edit a section.

The new RAG layer is a direct, single-call service behind `source`: query embedding, vector/FTS candidate fusion, bounded excerpts and provenance, and classified per-stage deadlines. Under ADR-0019, the main-owned tool facade delegates that complete operation to a dedicated Worker so native search and provider waits cannot block Electron main. It does not plan queries with a second LLM, invoke Source v2, or make autonomous follow-up searches. Pi decides whether to call `source` again within its two-search budget.

### Data disposition

The clean-slate cutover retains these workspace data and filesystem assets unchanged:

- `knowledge_items`, `knowledge_chunks`, `knowledge_chunks_fts`, and the sqlite-vec rows referenced by `knowledge_chunks.vector_rowid`;
- source public references, metadata, and imported knowledge assets; and
- author-authored sections, Markdown files, and project brief data.

The cutover deletes legacy LLM-only data without backup, archive, read-only access, or migration compatibility:

- `llm_generation_sessions`, `llm_generation_rounds`, and their indexes;
- `writing_patches` and `generation_citations` records created by the former generation pipeline; and
- legacy generation/retrieval trace payloads, IPC names, shared types, renderer state, tests, and documentation.

New Pi runs are in-memory, scoped to the active Electron process, and are discarded on completion, cancellation, restart, or workspace switch. The UI may display a redacted, bounded live timeline and a pending patch while the app remains open; it does not create agent-history tables or a run archive.

### Model and security boundary

The model adapter uses Pi AI's native provider/model surface via `@earendil-works/pi-agent-core`; the Vercel AI SDK is removed from interactive generation. Provider credentials remain in the Electron main process and outbound-data consent is checked before every model, embedding, or rerank request. Pi built-in tools, shell, filesystem, network, settings, raw database, and direct document-write access are never registered.

## Consequences

- Existing writer-facing generation history and unresolved legacy patches disappear during the cutover. This is explicitly authorized; only the knowledge index and author documents are retained.
- Existing indexed sources remain immediately searchable when their preserved embedding configuration is valid for the stored vectors. A mismatch is a typed `embedding_configuration` failure with an explicit reindex action, never a silent empty result.
- The retrieval timeout is split into visible stages: embedding, local search, rerank, and total tool deadline. A failure is projected as a typed `source` tool outcome, not a generic 45-second Retrieval timeout.
- The clean-slate boundary does not mean all new code shares Electron main. Pi authority remains in main, while the non-authoritative RAG Worker receives only one bounded request and is terminated on cancellation or deadline.
- ADR-0008's durable agent-trace storage is superseded. ADR-0012 remains the sole-runtime and review-boundary decision, except its legacy-history/archive requirements are replaced by this decision.

## Linked implementation work

| Task | Contribution |
| --- | --- |
| PIA-004 | Implement and prove the Pi-native model adapter with a deterministic fake. |
| PIA-005 | Delete legacy LLM data/schema while preserving the knowledge index and define ephemeral run state. |
| PIA-006 | Implement the sole in-memory Pi AgentManager runtime. |
| PIA-007 | Implement the new bounded `source` RAG service and allowlisted tools. |
| PIA-008 | Create review-only patches from Pi proposals for continue/rewrite/replace. |
| PIA-009, PIA-010 | Replace all legacy IPC and UI with a safe live Pi projection. |
| PIA-011, PIA-012, PIA-013 | Prove timeouts, lifecycle, policy, no-direct-write, index retention, and Electron behavior. |
| PIA-014 to PIA-016 | Evaluate the new flows, document them, and delete every legacy implementation path. |

### Completion conditions

- [ ] No interactive code path imports the Vercel AI SDK, retrieval planner, Source v2 evaluator, or legacy generation runtime.
- [ ] Pi runs all continue/rewrite/replace actions through the same scoped patch-proposal contract.
- [ ] `source` is bounded, provenance-preserving, and classifies embedding, local-search, rerank, cancellation, and deadline failures.
- [ ] Cutover deletes all legacy LLM history while tests prove existing indexed sources and vector/FTS retrieval are retained.
- [ ] Typed IPC/UI render only live, redacted Pi projections and pending review patches.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | User authorized a clean-slate LLM/RAG replacement: retain indexed knowledge sources and author documents; delete legacy LLM history and compatibility. PIA-004 was claimed to begin the Pi-native adapter. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | ADR-0019 refined the clean RAG implementation after live evidence showed direct sqlite-vec/FTS execution in Electron main prevented interaction. The replacement remains free of Source v2 and legacy planning, but now executes each bounded `source` request in a disposable Worker with main-owned cancellation and diagnostics. |
