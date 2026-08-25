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

- The compaction source reader now projects safe fields page by page, selects only complete
  `run_completed` / `run_interrupted` boundaries under the model-input budget, and rejects a
  single atomic run above that budget or 2,000 source events as `compaction_run_too_large`.
- The field regression is covered with one 415-event interrupted run containing 101 assistant
  messages and 104 tool calls. Its exact clarification survives projection, private query/source
  bodies stay out, and every original event row remains unchanged.
- Main starts one `finalize` authorization at 180 durable run events. Worker removes tools for that
  call and uses the application finalization instruction. Authorized continuations left pending by
  Pi receive one explicit `continue()` recovery, then fail as `continuation_lost` if still pending.
- Renderer distinguishes irreversible oversized-source failures, preserves retry guidance for
  temporary summary failures, and exposes a New conversation action without treating logs as
  recovery authority.
- Focused verification passed 134 tests across compaction, session, worker, contracts, provider
  reconstruction, and Renderer projection. `pnpm check:fast` passed. The canonical full suite
  passed 200 files / 1,131 tests with three intentional benchmark skips. `pnpm check:electron`
  passed the same suite plus a production build. Fresh `pnpm check:e2e` passed 46/46 scenarios with
  no flaky, skipped, or failed scenarios.
- The protected recovery manifest was intentionally refreshed for the extended Agent session
  source; all 27 fixtures from 25 sources passed. `pnpm check:package` then passed Electron 43.4.1
  / ABI 148, arm64 native and 53,287-entry ASAR inventory, no-Team-ID signature policy, all 12
  packaged smoke scenarios, and 33/33 packaged E2E scenarios. It produced structurally verified
  local DMG and ZIP artifacts from the dirty implementation worktree. No release signing,
  notarization, promotion, publication, hosted CI, commit, tag, or push ran.
