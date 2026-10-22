# WriteLLM Phase 22 Implementation Plan

Status: Checkpoint 73 is complete under ADR 065.
Recorded: 2026-08-26

## Checkpoint 73: Agent Sidebar Focus Hierarchy

- [x] Merge conversation status into the searchable header and group conversations by attention.
- [x] Collapse successful activity into human-readable summaries while keeping active and failed
  work visible.
- [x] Replace the floating Writing Task capsule with a bounded inline task row and unify
  clarification, review, and recovery in the attention dock.
- [x] Add bounded composer growth, visible non-default context, and collapsed waiting messages.
- [x] Cover desktop, keyboard, reduced-motion, background-session, and existing Agent flows.
- [x] Pass focused tests, `check:fast`, `check:electron`, fresh `check:e2e`, scoped Impeccable,
  bounded visual QA, and `git diff --check`.
- [x] Build and verify the separately authorized local no-identity macOS arm64 App.

## Local evidence

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-22.md#local-evidence).