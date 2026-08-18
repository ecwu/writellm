# ADR 049: Harness-Style Writing Context Compaction

Status: accepted for Checkpoint 54
Date: 2026-08-18

## Context

ADR 019 introduced auditable rolling checkpoints, but the implemented projection shortens every
user and terminal assistant message above 1,024 characters before the compaction model sees it.
It also marks the resulting checkpoint as authority-free data and gives manual compaction a zero
post-compaction target. Hands-on use showed that requirements in the middle of long requests can
therefore disappear even though the raw Agent events remain intact.

Current coding harnesses instead combine fresh canonical instructions, a semantic handoff for old
work, and a token-bounded recent transcript. WriteLLM needs the same continuity pattern while
retaining its stricter manuscript, evidence, proposal, and tool-authority boundaries.

## Decision

Checkpoint 54 keeps three model-visible layers. Main rebuilds application policy, the current
Brief, Outline, active Writing Rules, selected Writing Skill, and current manuscript context on
every run. A versioned semantic checkpoint records older conversational intent and workflow state.
A recent suffix of complete user/assistant turns remains verbatim, while the current request stays
outside compaction and is never recursively truncated.

The post-compaction history budget is the smaller of 32,000 tokens and half of the final
conversation budget. The checkpoint receives the smaller of 12,000 tokens and 37.5 percent of
that post-compaction budget; the remainder is reserved for recent complete turns. At the normal
maximum this yields a 12,000-token handoff and a 20,000-token raw tail. Automatic and manual
compaction use the same policy. A newest complete turn may borrow unused checkpoint capacity, but
an indivisible turn that cannot fit the full conversation budget fails before provider work rather
than being shortened or silently omitted.

User and terminal assistant messages enter the compaction model verbatim. Main selects the oldest
complete run boundaries that fit the compaction request's own provider limit and retains the
existing 240-event hard ceiling. Tool calls and results remain safe typed projections: source
bodies, credentials, private paths, and large untrusted result text never enter the handoff.

New checkpoints use payload schema v3 and `handoffMode = bounded_conversation_memory`. Their
summary remains inside an escaped `instructionSemantics="false"` block with
`authority="conversation_memory"`. An application-authored policy tells the Agent to preserve the
recorded user goal, constraints, exclusions, decisions, and unresolved work unless the current
request supersedes them. The handoff cannot authorize a tool, proposal, approval, mutation, or
effect; supply a current version/hash/ID; or establish manuscript and evidence truth. Those still
require current system context and ordinary bounded reads. Legacy and v2 checkpoints remain
readable with `authority="none"` until a successful v3 checkpoint replaces them.

The writing-specific handoff distinguishes active requirements from superseded directions and
records the requested deliverable, writing intent and terminology, verified progress and proposal
outcomes, evidence and gaps, blockers, next action, and critical safe references. Each rolling
step must carry every still-active item forward because the prior checkpoint is replaced.

Automatic failure may continue only when the last successful checkpoint plus every later raw turn
fits without omission. If continuing would discard an uncheckpointed user message, the run fails
before the provider call with a retryable compaction error. Existing pre-activity provider-overflow
retry, no-replay-after-activity, cancellation, and raw-event authority remain unchanged.

## Consequences

Long writing conversations preserve recent wording and usable user constraints while keeping
canonical project state fresh. The design adds no compaction table, long-term memory, background
job, provider-specific prompt, IPC method, model-visible tool, or database migration. Existing raw
events and project business rows remain authoritative.

Checkpoint payload v3 extends the shared event contract with explicit handoff and budget metadata;
legacy and v2 payloads remain replayable. Manual compaction becomes less aggressive by design. A
single historical turn larger than the available conversation budget is reported honestly instead
of producing a misleading partial summary.

This ADR amends ADR 019's 24,000-token target, zero-target manual behavior, authority-free runtime
projection, and silent deterministic omission fallback. ADR 046's active Pi tool-batch recovery is
unchanged and remains downstream of the durable conversation-history projection.

## Alternatives Rejected

- Keep the 1,024-character head/tail projection. It is deterministic but deletes the exact middle
  of long writing requirements before semantic compaction begins.
- Add a persistent editable memory or rule ledger. The current need is conversation continuity;
  permanent author requirements already belong in Brief or Writing Rules.
- Treat the handoff as trusted manuscript or mutation authority. Model-generated summaries cannot
  safely replace current revisions, evidence reads, proposal outcomes, or user approval.
- Preserve only recent user messages. This protects instructions but loses the assistant decisions
  and writing-work state needed for a coherent handoff.
- Continue after summary failure by silently dropping old raw turns. That hides instruction loss
  and makes the resumed model context impossible for the author to reason about.
