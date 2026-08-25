# ADR 064: Writing Harness Semantic Compaction

Status: accepted for Checkpoint 72; implementation authorized
Date: 2026-08-25

## Context

Checkpoint 71 removed the fixed 240-event source ceiling, but a field run still produced a
compaction prompt above the Agent request's 262,144-character contract. Its 104 Knowledge tool
results repeated re-readable source metadata and result projections even though raw Agent events
and current project databases remained authoritative.

Coding harnesses retain conversational intent and deterministic continuation facts rather than
using compaction as a cache for tool output. WriteLLM can apply a stricter form of that policy
because Knowledge, manuscript, Writing Skill, proposal, review, and task state are addressable and
can be reread through bounded tools.

## Decision

- Complete-run boundaries continue to define checkpoint coverage, but re-readable observation
  bodies are not indivisible context. Raw events remain byte-for-byte authoritative and are never
  deleted or rewritten by compaction.
- Compaction uses an exhaustive per-tool policy. User messages, clarification context, terminal
  assistant messages, authoritative proposal/approval/review/task outcomes, and citations actually
  expanded or used receive priority. Knowledge/manuscript/Skill bodies, search queries and
  snippets, proposal draft bodies, diffs, image prompts, and intermediate tool-use narration do
  not enter the compaction model.
- Re-readable observations retain only deduplicated safe identity and freshness facts such as IDs,
  revisions, hashes, bounded display labels, page ranges, counts, and truncation state. Tool calls
  and results are represented once as bounded continuation facts; a new tool without an explicit
  policy is a compile-time and test failure.
- Candidate sizing uses the final escaped compaction prompt. The 2,000-event scan ceiling, the
  262,144-character Agent prompt contract, and the calculated model-input token budget all fail
  closed before provider work. Low-priority diagnostics and then oldest unused observation facts
  may be removed; conversational requirements and authoritative outcomes may not.
- Payload-v3, existing Agent events, current IPC, and current project tables remain compatible.
  No migration, compaction table, background summary task, provider-specific checkpoint, or
  long-term implicit memory is introduced.

## Consequences

Repeated Knowledge reads no longer dominate summary input, while the resumed Agent still knows
which canonical sources and revisions must be reread. A single semantic run that cannot fit after
permitted projection fails explicitly as `compaction_run_too_large` without provider activity.

Structured logs expose only counts, sizes, reasons, and safe IDs. Renderer presentation treats an
older failed attempt as recovered once a later successful checkpoint supersedes it, while the raw
failure event remains available for audit.

This ADR amends ADR 049's complete-run projection semantics and ADR 063's source-budget check. Their
raw-event authority, bounded recent tail, no-silent-user-omission, and fail-closed continuation
rules remain in force.
