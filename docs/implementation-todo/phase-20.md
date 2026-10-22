# WriteLLM Phase 20 Implementation Plan

Status: Checkpoint 71 is complete under ADR 063.
Recorded: 2026-08-25

## Checkpoint 71: Agent Automatic Compaction And Tool-Loop Recovery

- [x] Replace the 240-event compaction ceiling with complete-run paginated projection bounded by
  model input and a 2,000-event absolute scan limit.
- [x] Add explicit `compaction_run_too_large` failure and preserve raw history on every failure.
- [x] Finalize writing runs after 180 durable events with one tool-free provider call.
- [x] Recover an authorized continuation after an early Pi settlement or fail as
  `continuation_lost`.
- [x] Add Renderer recovery guidance, structured logs, regression coverage, and full gates.

## Local evidence

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-20.md#local-evidence).