# ADR 074: Agent Occam Ablation And Error Propagation

Status: accepted
Date: 2026-09-02

Current rule: ADR 083 replaces only the removal of the admission cap. Main now permits three active Agent/Notebook runs in total and rejects overflow immediately.

## Context

Separate limits for events, concurrency, Skills, recovery, and diagnostics interrupt useful model work.
They add runtime states and hide specific errors behind general error labels.
The user approved removing these extra limits, summarizing older history with some loss, and recording traces when possible.
The user also approved showing specific errors after removing sensitive data.
No live-provider benchmark, new setting, dependency, or migration is required.

Source references are fixed at [Codex compaction](https://github.com/openai/codex/blob/5971d42847aae04db0e3c70146e0b189fc9a6803/codex-rs/core/src/compact.rs),
[OpenCode session loop](https://github.com/anomalyco/opencode/blob/69c172e8a7c0086887b1f93ed5a162f14b6aa0c5/packages/opencode/src/session/prompt.ts), and
[Pi Agent loop](https://github.com/earendil-works/pi/blob/e266507b606b9552fa277252644054afd4384b11/packages/agent/src/agent-loop.ts).
Their loops, context summaries, on-demand Skill reads, and transient retries inform this decision.
None grants WriteLLM permission to act or change a manuscript.

## Decision

- Protocol v14 removes event-count finalization and project/Worker three-work admission caps.
  Each conversation permits one active run or manual compaction at a time. Every request retains exact project/run authorization.
- Context uses the model's actual input/context limits and output reserve.
  It does not add a five-percent buffer.
  One summary replaces rolling four/eight-step compaction, the 2,000-event scan ceiling, complete-run coverage requirements, and independent 32K/half-window targets.
  Keep current requests and assistant/tool-result batches intact.
  Recent complete turns fill available context. Older tool facts and messages enter one summary within the input limit.
  Record the count of omitted oldest input. Schema-v4 checkpoints are memory, not authoritative state or instructions.
- Oversized read batches independently return a smaller-read delivery error through the ordinary
  Pi loop. There is no retry counter or terminal recovery state. An irreducible current request
  fails with its actual token requirements. Mutation/effect results are never projected.
- Explicit Skill mentions inject selected root entrypoints without their full dependency set.
  Automatic reads return ordinary tool results. They can share a batch with other reads.
  They do not add mandatory system-prompt content.
  Remove runtime root/dependency/reference counts and cumulative reference-byte limits.
  Keep manifest, commit/hash, virtual URI, path, per-file, and generic payload bounds.
  Available prompt space determines catalog inclusion. V4 snapshots record which sources were read or injected.
- Five pre-content physical provider attempts and one pre-activity overflow compact-and-retry
  remain cost/no-replay safeguards. Transient attempts are info/debug, not attention warnings.
  Live retry anchors, one-use retry authorizations, waiting states, and their UI are removed.
  After a real failure, the next user message starts an ordinary new run.
- Trace capture is asynchronous and best effort. Network I/O does not wait for a trace acknowledgement.
  If serialization, capacity, or storage fails, log the original error through structured logging.
  If storage is available, record a metadata-only gap.
  Trace failures never fail model work. Trace data never authorizes recovery or mutation.
- A shared bounded diagnostic preserves stage, name, code, message, HTTP status, cause chain, and
  optional stack across Worker/Main. Main logs the original error before transformation. Safe
  diagnostic projections redact credentials, headers/cookies, signed URLs, private bodies, and
  absolute paths without replacing meaningful errors with generic prose. Run failure payload v2
  and existing `error_json` retain these details for direct Renderer display.
- Tool recovery suggests an optional action. It does not limit attempts.
  New output never emits `maxAttempts` or "retry once".
  Show specific errors inline. Show causes and stacks through existing expandable components.
  Ordinary recoverable activity does not create attention docks.

IPC/Zod and byte bounds, pending-queue/pagination limits, `ask_user` interaction rules, one mutation
per batch, no mixed mutation batch, approval/version checks, and revocable project capabilities
remain authoritative. No current request is silently truncated and no completed effect is replayed.

## Compatibility And Consequences

Existing tables and immutable rows remain unchanged. Readers accept legacy compaction/Skill
snapshots, `model_retry` events, `maxAttempts`, trace failure statuses, and code-only run errors.
New runtime protocols remove finalize, trace ACK, live retry authorization, and fixed capacity.
New checkpoints and Skill snapshots use v4. Failures use v2 diagnostics with nullable
`AgentRunRecord.errorDetails`. No database migration is needed.

This ADR supersedes the conflicting one-recovery, rolling/no-loss compaction, complete Skill
preparation, trace fail-closed, and live retry clauses in ADRs 046, 063, 064, 069, 071, 072, and 073.
Their security, persistence ownership, and no-replay invariants otherwise remain in force.

Rejected alternatives are warning-only cosmetic changes, configurable strict/lenient modes,
replacement numerical thresholds, and a new long-lived ablation framework. Verification uses
deterministic replay/fault injection. The implementation must remove more runtime policy code than it adds.
