# Phase 33: Manuscript Comments And Agent Resolution

## Checkpoint 84

Authority: accepted ADR 078 and the user's explicit implementation request on 2026-09-04.

### Implementation checklist

- [x] Add project-local comment thread, message, anchor, event, delegation, and verification state.
- [x] Add session-authorized Main IPC and preload contracts for author comment lifecycle.
- [x] Add left-sidebar Comments, selection creation, decorations, navigation, filtering, and batch selection.
- [x] Add Agent read/reply/resolve tools with current-revision verification and existing proposal approval.
- [x] Cover migration, anchor relocation/orphaning, optimistic concurrency, recovery, UI, and Agent flows.
- [x] Complete scoped static, Electron-hosted, real-Electron, and packaged-runtime verification.

### Local evidence

- Migration 0044 owns comment threads, messages, events, Agent read receipts, revision invalidation,
  and proposal-undo reopening in project SQLite. All revision-producing paths pass through the
  `sections.current_revision_id` trigger, so an old range is never presented as current before
  quote-based relocation or explicit author relinking.
- The author surface supports toolbar, context-menu, and `Cmd/Ctrl+Alt+M` creation, persistent
  drafts while switching sidebar views, bidirectional navigation, overlap selection, open/resolved
  filters, search, current-section scope, reply, edit, delete, resolve, reopen, relink, and single or
  multi-thread Agent delegation.
- Agent tool contract v16 adds `list_comments`, `read_comment`, `reply_comment`, and
  `resolve_comment`. Resolution requires a current thread receipt and a subsequent full section
  read for the same run and revision. Optional proposal linkage requires an applied revision;
  operation IDs deduplicate replies and resolutions, and undo reopens linked resolutions.
- `pnpm check:fast` passed all three stages in 8.9 seconds. Seven focused files passed 53 tests in
  1.5 seconds; the final atomic-resolution subset passed 14 tests in 1.2 seconds. The final
  real-Electron comment scenario passed in 2.9 seconds without retries. The final macOS arm64
  package smoke passed all six stages in 77.3 seconds, including a fresh production build and 12
  packaged runtime scenarios.
- Reports: `.cache/verification/1788561277977-56814-fa05b353`,
  `.cache/verification/1788560744278-51847-965c485f`,
  `.cache/verification/1788561221750-56344-be5dafc2`, and
  `.cache/verification/1788561368063-57752-4df380ed`.
- The first package-smoke attempt reached packaging and failed only on sandbox DNS
  (`ENOTFOUND github.com`); the same gate passed outside the sandbox. Three early E2E iterations
  exposed test-selection timing/assertion issues before the deterministic final scenario passed.
  Functional source did not require a retry. Verification is local macOS arm64 with fixture
  providers; other operating systems and live provider credentials remain unverified.
