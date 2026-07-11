---
id: ADR-0017
title: Expose bounded knowledge retrieval through the Pi source tool
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-004, PIA-D-010]
related_tasks: [PIA-007, PIA-011, PIA-012, PIA-014, PIA-016, PIA-019]
depends_on: [ADR-0004, ADR-0011, ADR-0012, ADR-0014, ADR-0016]
external_task_gates: [SEC-003, REL-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0017: Expose bounded knowledge retrieval through the Pi `source` tool

## Context

The current optional Source v2 retrieval mode is part of the legacy interactive-generation pipeline. It receives a batch of planned queries, runs up to three retrieval rounds, calls a chat model directly to select evidence and formulate additional queries, and emits `KnowledgeRetrievalTraceEvent` updates. This makes it a hidden, worker-owned agent loop rather than a bounded retrieval operation.

That design conflicts with the target Pi runtime. ADR-0012 requires Pi to own turn sequencing, the decision to search again, tool budgets, cancellation, terminal diagnostics, and the author-visible tool event timeline. The MVP permits at most two knowledge-search calls per Pi run, while Source v2 can independently make multiple retrieval and chat-model calls within one apparent operation. The existing one-shot retrieval planner introduces a second, parallel planning layer.

The underlying local capabilities remain valuable: hybrid vector and full-text retrieval, optional reranking, source provenance, a 45-second total retrieval deadline, workspace lifecycle cancellation from ADR-0016, and the outbound-data policy from ADR-0014.

## Decision

Pi's allowlisted `source` tool replaces interactive use of Source v2. The tool itself performs exactly one bounded local retrieval operation; Pi, not the tool, decides whether another query is needed. `source` replaces the planned `search_knowledge` label in the Pi contracts updated with this decision.

### Tool contract

The agent-facing input is a schema-validated query string. Workspace identity, focused section, retrieval limits, source exclusions, and provider settings are derived from the active Pi run and are not agent-controlled parameters.

The successful result contains at most the configured evidence limit, with each source limited to stable item/chunk IDs, public reference, title, bounded snippet, score, retrieval method, and retrieval reason. The tool persists a corresponding evidence-manifest entry for the run. It does not return raw database records, full source files, provider objects, credentials, or unrestricted tool arguments.

The tool returns one classified terminal result on failure or cancellation. At minimum it distinguishes provider configuration/authentication, consent denial, provider transport failure, retrieval deadline, cancellation, and tool-policy denial. A worker deadline maps to a retry-safe `retrieval_timeout` `tool_execution_end` outcome; it is never converted to an empty successful result.

### Execution model

```text
Pi Agent turn
  -> source(query)
    -> main-process tool facade validates run scope and budget
      -> dedicated source Worker: embedding + vector/FTS + optional rerank
      <- bounded, provenance-preserving sources or classified failure
  <- Pi decides whether to continue, finish, or use its second permitted search
```

- A Pi run may invoke `source` at most twice and remains subject to the 120-second run budget, 45-second per-search deadline, six-turn limit, and eight-tool-call limit.
- Each call receives the run `AbortSignal`. Main owns the 45-second deadline and terminates the dedicated Worker on cancel, deadline, error, or abnormal exit; the Worker also applies embedding/rerank/total classification inside the operation.
- Renderer projections report bounded `tool_execution_*` activity: tool name, status, source-reference count, public references where appropriate, failure category, retryability, and concise redacted cause. They do not reuse legacy retrieval traces as the Pi timeline.
- Embedding and rerank calls use an immutable minimum-necessary settings and consent snapshot supplied by main. The Worker must not read Electron application storage directly, persist credentials, invoke Pi, or gain independent tool authority.

### Source v2 disposition

The Source v2 outer loop, direct chat-model evaluator, autonomous next-query generation, and legacy `sourcev2` interactive request mode are not part of the Pi tool. Pi's own turns replace those decisions.

ADR-0018 requires a clean reimplementation of the RAG service. PIA-007 does not retain Source v2 helpers; PIA-016 removes the Source v2/planner route and its traces without archive compatibility.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Wrap the current Source v2 loop as one Pi tool | Rejected: hidden chat calls, autonomous searches, and three-round behavior bypass Pi's turn/tool budget and observability contract. |
| Expose separate candidate-search and LLM-evaluator tools | Rejected for the MVP: it expands the allowlist and duplicates Pi's evidence reasoning with another provider boundary. |
| Use a single hybrid retrieval tool and let Pi request follow-up searches | Proposed: preserves local retrieval quality and provenance while keeping decisions, budgets, and events in the canonical Pi runtime. |
| Replace local retrieval with web research | Rejected: external research is out of scope for the MVP and requires separate permission, provenance, and consent decisions. |

## Consequences and constraints

- The first Pi implementation has less hidden automatic query expansion than Source v2, but has explicit, reviewable multi-turn retrieval decisions.
- No interactive Pi path imports the legacy retrieval planner or calls `retrieveKnowledgeSourcesV2` as an autonomous loop.
- The Pi model adapter is the only interactive chat-model boundary. Embedding and reranking remain retrieval implementation details subject to their existing settings, consent, and diagnostics contracts.
- Embedding, sqlite-vec, FTS, fusion, and rerank must not execute on Electron main's event loop. ADR-0019 owns this isolation and the cancel-by-termination fallback.
- `source` must treat author instructions and retrieved source text as untrusted evidence, never as tool-policy instructions.
- PIA-014 must compare Source v2 and Pi-tool retrieval on a representative evidence corpus before cutover. A material usefulness regression is a release blocker, not a reason to retain a hidden legacy fallback.
- This ADR does not add a new agent capability, external network access, direct document mutation, or a renderer-visible raw-query/raw-source trace.

## Linked implementation work

Task state, owner, and evidence are canonical in the project task tracker.

| Task | Contribution to this decision |
| --- | --- |
| PIA-019 | Review this Source v2-to-tool design and record the architecture decision. |
| PIA-007 | Implement the allowlisted tool schema, bounded result formatter, evidence manifest, policy checks, and classified failures. |
| PIA-011 | Integrate per-search deadline, cancellation, active-work lifecycle, and run/tool budgets. |
| PIA-012 | Add provider-free tool-policy, provenance, error-classification, cancellation, and no-hidden-loop tests. |
| PIA-014 | Compare the proposed tool behavior with Source v2 on the evaluation corpus and resolve material regressions. |
| PIA-016 | Remove the legacy planner/Source v2 interactive route only after the Pi replacement is verified. |

### Decision acceptance conditions

- [x] The `source` tool contract, error vocabulary, event projection, and Source v2 disposition are approved.
- [x] PIA-007 is unblocked with a concrete schema and explicit budget/lifecycle constraints.

### Completion conditions after acceptance

- [x] `source` performs one bounded provenance-preserving retrieval and records live-run evidence without a direct chat-model evaluation.
- [ ] A Pi run, rather than the retrieval service, decides whether a second search occurs; the two-search and 120-second budgets are enforced.
- [ ] Timeout, cancellation, policy, configuration, and transport cases become typed Pi tool outcomes; deterministic lifecycle tests prove a stuck Worker is terminated and a later call starts cleanly.
- [ ] Provider-free tests and the evaluation corpus demonstrate parity or an accepted improvement plan before PIA-016 deletes the legacy path.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | PROPOSED | NOT_STARTED | Drafted after reviewing Source v2 against the accepted Pi tool, budget, lifecycle, and event contracts. No runtime code changed. |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Architecture review approved the single-call `source` tool, Pi-owned follow-up decisions, 2-search/120-second/45-second bounds, safe event/error projection, and Source v2 cutover disposition. PIA-007 is the next implementation task; no runtime code changed by this decision. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-007 implemented `sourceService.ts` and the closed Pi tool facade. It performs one hybrid vector/FTS search with optional reranking, embedding/rerank/total cancellation deadlines, bounded provenance-only output, live-only evidence manifest entries, consent checks, and typed failures; it imports neither Source v2 nor Vercel retrieval. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Live testing showed the direct clean service still blocked Electron main during RAG. ADR-0019 moved the complete `source` operation into a per-search Worker while main retained scope/budget validation, the run signal, 45-second deadline, typed result projection, and authoritative termination. A real Electron-runtime loopback check completed while main timers continued advancing. |
