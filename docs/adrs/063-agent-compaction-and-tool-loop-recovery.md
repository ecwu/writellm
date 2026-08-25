# ADR 063: Agent Compaction And Tool-Loop Recovery

Status: accepted for Checkpoint 71; implementation authorized
Date: 2026-08-25

## Context

A hands-on writing run produced 415 durable events in one interrupted run. The existing compaction
reader stopped after 240 events, before reaching that run's terminal boundary, so no complete
historical run could be summarized even though its safe projection fit the selected model. The same
run exposed a Pi lifecycle edge: a tool continuation was authorized and persisted, but the Worker
settled before consuming it, leaving Main to reject the run with an unfinished model request.

Raw Agent events remain authoritative. Recovery must not split a run, replay tools, or silently omit
user requirements.

## Decision

- Replace the fixed 240-event compaction page with a paginated scan that retains only safe projected
  data, chooses complete `run_completed`/`run_interrupted` boundaries, and remains bounded by the
  compaction model's calculated input budget. A 2,000-event absolute scan ceiling protects local
  memory and database work. A complete run that exceeds either bound fails explicitly as
  `compaction_run_too_large`; original events remain unchanged.
- Main begins finalization when a writing run has at least 180 durable events at a tool-continuation
  boundary. The authorized continuation is marked `finalize`; Worker removes tools from the next Pi
  context and adds application-authored guidance to return the best supported answer and identify
  unfinished work. Notebook does not persist Agent events and never receives this flag.
- Worker treats an authorized but unconsumed continuation as a recoverable Pi-loop settlement edge.
  It resumes from the final tool result with `continue()`. If the authorization still cannot be
  consumed, the run fails as `continuation_lost`; Main continues to reject successful settlement
  while any model request remains pending.
- Existing payload-v3 checkpoints, raw event authority, provider-overflow no-replay rules, proposal
  authority, and current-request preservation remain unchanged. No table, migration, background job,
  model-visible tool, or Renderer authority is added.

## Consequences

Long terminal runs can be summarized without weakening complete-run boundaries. New pathological
tool loops receive one bounded tool-free final response before they can grow indefinitely. Lifecycle
faults become diagnosable without treating an aborted cleanup request as the original failure.

The shared authorization contract gains optional `finalize` with a default of `false`. Renderer
recovery text distinguishes a source run that cannot be compacted from ordinary provider failure and
offers the existing new-conversation command as the safe escape hatch.

This ADR amends ADR 049's fixed 240-event hard ceiling. Its semantic checkpoint, recent-tail,
authority, and no-silent-omission decisions remain in force.
