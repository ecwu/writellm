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

- Renderer-only presentation helpers now derive header status and attention-grouped conversation
  sections without changing session, run, task, or proposal authority.
- The Agent surface uses a stable header, timeline, inline Writing Task row, attention dock, and
  bounded composer hierarchy. Successful activity collapses by default; active, failed, stopped,
  clarification, and review states remain visible with icon-and-text status. Waiting follow-ups and
  non-default composer context use local progressive disclosure.
- Focused Renderer coverage passed: 2 files / 46 tests for task attention, conversation grouping,
  header state, timeline projection, and existing Agent presentation behavior.
- `pnpm check:fast` passed. `pnpm check:electron` passed 200 files / 1,140 tests with three
  intentional benchmark skips, followed by a successful production build.
- The fresh `pnpm check:e2e` gate passed all 46 Real-Electron scenarios with no flaky, skipped, or
  failed scenario, including background conversations, clarification, proposal review, Writing
  Task identity, queue/steer/stop behavior, and keyboard accessibility.
- Bounded runtime visual QA included the desktop Agent sidebar. The one correction reduced the
  expanded task height and fixed the composer in place; confirmation screenshots show a continuously
  visible primary action. Evidence lives under `.impeccable/review/cp73/`.
- The scoped Impeccable detector reported no findings. Reduced-motion and icon-plus-text state
  treatment were inspected, and `git diff --check` passed. No dependency, database, IPC, shared
  Agent protocol, tool permission, or persistence format changed.
- The separately authorized unpacked App gate refreshed the protected Agent recovery source digest
  after its CP72 fixture changed, then passed all 27 recovery cases from 25 sources, the production
  build, arm64 native and 53,287-entry ASAR inventory, no-Team-ID signature policy, all 12 packaged
  smoke scenarios, and 33/33 packaged E2E scenarios. It produced
  `dist/macos-arm64/mac-arm64/WriteLLM.app`; no DMG, ZIP, release, commit, tag, push, signing identity,
  notarization, promotion, or publication action ran.
