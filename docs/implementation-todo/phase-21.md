# WriteLLM Phase 21 Implementation Plan

Status: Checkpoint 72 is complete under ADR 064.
Recorded: 2026-08-25

## Checkpoint 72: Writing Harness Semantic Compaction

- [x] Replace generic tool payload projection with an exhaustive, writing-specific continuation
  fact policy that discards re-readable bodies and deduplicates source identity.
- [x] Size the final escaped compaction prompt against exact character and model token budgets.
- [x] Preserve payload-v3 and raw event authority while removing duplicate model-visible tool
  outcomes and low-value intermediate narration.
- [x] Resolve superseded compaction-failure presentation without changing durable audit events.
- [x] Add field-scale, all-tool, privacy, budget, compatibility, and Renderer recovery coverage.
- [x] Pass focused tests, `check:fast`, the full suite, `check:electron`, and fresh `check:e2e`.

## Local evidence

- Exhaustive `AgentToolName` coverage now rejects unclassified tools at compile time. Knowledge,
  citation, manuscript, section, Skill, proposal, review, image, and task observations retain only
  bounded identity, revision, status, and outcome facts; re-readable bodies and duplicate
  narration are excluded.
- The field-scale fixture covers 415 events, 101 assistant messages, 104 tool calls, and more than
  1.5 MB of Knowledge results. Its final escaped prompt stays below 262,144 characters, preserves
  byte-identical raw events, deduplicates source revisions, and excludes seeded private content.
- Focused compaction, service, and Renderer coverage passed 104/104 tests. `pnpm check:fast`
  passed; the full Electron-hosted suite passed 200 files and 1,137 tests with three benchmark
  skips. The `check:electron` suite and a clean production build passed.
- Fresh `pnpm check:e2e` passed all 46 required Real-Electron scenarios with no flaky, skipped, or
  failed scenarios. No package, release, commit, tag, push, signing, or publication action ran.
