# ADR 074: Agent Occam Ablation And Error Propagation

Status: accepted
Date: 2026-09-02

## Context

Independent event, concurrency, Skill, recovery, and diagnostic budgets have become execution
policy rather than protection of an authority boundary. They interrupt useful model work, multiply
state machines, and hide actionable errors behind generic classifications. The user explicitly
approved structural ablation, lossy older-history summaries, best-effort traces, and direct safe
diagnostics. No live-provider benchmark, new setting, dependency, or migration is required.

Source references are fixed at [Codex compaction](https://github.com/openai/codex/blob/5971d42847aae04db0e3c70146e0b189fc9a6803/codex-rs/core/src/compact.rs),
[OpenCode session loop](https://github.com/anomalyco/opencode/blob/69c172e8a7c0086887b1f93ed5a162f14b6aa0c5/packages/opencode/src/session/prompt.ts), and
[Pi Agent loop](https://github.com/earendil-works/pi/blob/e266507b606b9552fa277252644054afd4384b11/packages/agent/src/agent-loop.ts).
Their default loops, token-pressure compaction,
progressive Skill disclosure, and quiet transient recovery inform this decision; none supplies
WriteLLM authorization or manuscript authority.

## Decision

- Protocol v14 removes event-count finalization and project/Worker three-work admission caps.
  Conversations remain single-line and every request retains exact project/run authorization.
- Context uses the model's actual input/context limits and output reserve, without the additional
  five-percent buffer. One summary replaces rolling four/eight-step compaction, the 2,000-event
  scan ceiling, complete-run coverage requirements, and independent 32K/half-window targets.
  Current requests and assistant/tool-result batches remain atomic. Recent complete turns fill
  available context; older generic tool facts and messages enter one bounded summary. Omitted
  oldest input is counted explicitly. Schema-v4 checkpoints are non-authoritative memory.
- Oversized read batches independently return a smaller-read delivery error through the ordinary
  Pi loop. There is no retry counter or terminal recovery state. An irreducible current request
  fails with its actual token requirements. Mutation/effect results are never projected.
- Explicit Skill mentions inject selected root entrypoints, not dependency closure. Automatic
  reads return ordinary tool results, may coexist with other reads, and do not accumulate mandatory
  system-prompt content. Runtime root/dependency/reference counts and cumulative reference-byte
  gates are removed. Manifest, commit/hash, virtual URI, path, per-file, and generic payload bounds
  remain. Catalog inclusion derives from prompt space. V4 snapshots record observed provenance.
- Five pre-content physical provider attempts and one pre-activity overflow compact-and-retry
  remain cost/no-replay safeguards. Transient attempts are info/debug, not attention warnings.
  Live retry anchors, one-use retry authorizations, waiting states, and their UI are removed.
  After a real failure, the next user message starts an ordinary new run.
- Trace capture is fire-and-forget and best effort. No trace acknowledgement gates network I/O.
  Serialization, capacity, and storage failures preserve the original error in structured logs
  and mark a metadata-only gap when storage is available, but never fail model work. Trace data
  remains diagnostic only and never authorizes recovery or mutation.
- A shared bounded diagnostic preserves stage, name, code, message, HTTP status, cause chain, and
  optional stack across Worker/Main. Main logs the original error before transformation. Safe
  diagnostic projections redact credentials, headers/cookies, signed URLs, private bodies, and
  absolute paths without replacing meaningful errors with generic prose. Run failure payload v2
  and existing `error_json` retain these details for direct Renderer display.
- Tool recovery is an optional action hint, not an attempt budget. New output never emits
  `maxAttempts` or "retry once". Specific error messages are visible inline; causes and stack use
  existing disclosure components. Ordinary recoverable activity does not create attention docks.

IPC/Zod and byte bounds, pending-queue/pagination limits, `ask_user` interaction rules, one mutation
per batch, no mixed mutation batch, approval/version checks, and revocable project capabilities
remain authoritative. No current request is silently truncated and no completed effect is replayed.

## Compatibility And Consequences

Existing tables and immutable rows remain unchanged. Readers accept legacy compaction/Skill
snapshots, `model_retry` events, `maxAttempts`, trace failure statuses, and code-only run errors.
New runtime protocols remove finalize, trace ACK, live retry authorization, and fixed capacity.
New checkpoints and Skill snapshots use v4; failures use v2 diagnostics with nullable
`AgentRunRecord.errorDetails`. No database migration is needed.

This ADR supersedes the conflicting one-recovery, rolling/no-loss compaction, complete Skill
preparation, trace fail-closed, and live retry clauses in ADRs 046, 063, 064, 069, 071, 072, and 073.
Their security, persistence ownership, and no-replay invariants otherwise remain in force.

Rejected alternatives are warning-only cosmetic changes, configurable strict/lenient modes,
replacement numerical thresholds, and a new long-lived ablation framework. Verification uses
deterministic replay/fault injection and should yield a net deletion of runtime policy code.
