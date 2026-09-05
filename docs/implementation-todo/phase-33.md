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

### Acceptance review — 2026-09-04

The earlier successful checks are valid for their tested paths but did not cover the accepted
feature contract. Independent review reproduced four failures through the canonical Electron
runner, using isolated project SQLite fixtures:

- Replacing selected `alpha` with `gamma` in the same block orphans the range instead of mapping
  it to the replacement.
- Changing `alpha alpha` to `alpha` after commenting on the first occurrence silently attaches
  the comment to the remaining occurrence. No old/new edit mapping establishes its identity.
- An orphaned thread can be resolved by an Agent with no applied deletion proposal evidence.
- Actual Main tools accept `read_section` with `blockIds: []`, return no blocks, and still let
  `resolve_comment` close the thread. Read receipts also omit model request identity.

Final probe run: 7 tests, 3 existing cases passed and 4 acceptance cases failed; Vitest 1.55 seconds,
wrapper 1.9 seconds, no automatic retries. An earlier six-case diagnostic run had the same three
anchor failures before adding the actual Main-tools empty-read case. Report:
`.cache/verification/1788562530358-65354-6f455b08`. Probe source is preserved at
`.cache/verification/comment-acceptance-review/comment-acceptance-probe.test.ts`; copy it back to
`src/main/manuscript/` to rerun its relative imports with the canonical test runner.

Static inspection additionally found that delegation persists events without a session/run link
from the UI, tools do not enforce selected thread membership, and the thread contract exposes
neither event/proposal history nor derived processing status. The detail view does not refresh
on revision changes or Agent comment writes. Overlapping highlights select `threadIds[0]` instead
of offering a chooser. The list ignores `nextCursor` after its first 100 records, and list/delegation
ordering uses creation time/title rather than manuscript anchor order.

No product code was changed during acceptance. Prior UI happy-path and packaged smoke evidence
was reused; no full Agent approval/continuation E2E or comment-specific packaged recovery test
was found. This review ran on macOS arm64 with isolated fixtures, not a live provider.


### Acceptance remediation evidence — 2026-09-05

Authorization: the author explicitly requested fixing the acceptance findings. ADR 079 supersedes
quote-only relocation and run-only receipts without restoring the removed Review implementation.
The preceding delivery and failed-review records remain historical evidence.

- Forward migration 0045 adds anchor revision/history, fixed session delegation, linked proposals,
  and model-request/read-coverage receipts. Migration 0044 remains unchanged. Backup, migration,
  integrity, project-copy recovery, and legacy downgrade fixtures are covered.
- Human and Agent revision producers call one bounded canonical-content mapper in the same SQLite
  transaction. Tests cover replacements, repeated text ambiguity, block movement/split/merge,
  cross-block ranges, Chinese/emoji, deletion, exact-content undo recovery, and explicit relinking.
- Main enforces delegated thread membership and an active Write run. Resolution requires current
  thread/revision receipts, all actual untruncated blocks or complete canonical fragments, and a
  subsequent model request. Empty block selections and incomplete pages do not qualify.
- Real Main-tool/proposal integration tests cover manual and automatic apply, fresh verification,
  stale/new-reply/cancelled/undelegated rejection, deduplication, deletion evidence, and undo reopening.
  A later independent author resolution is not reopened by undoing an older repair.
- The UI paginates beyond 100 threads in manuscript order, refreshes detail and highlights while
  preserving reply drafts, shows processing/events, opens proposal evidence across Agent sessions,
  and offers an overlap chooser. Delegation starts an existing or new Write session with a fixed set.
- Eight focused Electron-hosted files passed 72 tests: Vitest 4.60 seconds, wrapper 5.0 seconds,
  no automatic retries. Report: `.cache/verification/1788564075708-80629-1db1b30d`.
- Final macOS arm64 `check:package:smoke` passed six stages in 77.3 seconds, including static
  checks (9.1 seconds), a production build, native inventory, and 12 runtime scenarios (39.3 seconds).
  The lifecycle scenario now creates/replies/resolves/reopens a comment, closes/reopens the project,
  verifies persisted discussion/anchor state, and rejects the revoked project session.
  Report: `.cache/verification/1788564249419-82015-04016b0a`.
- Three affected real-Electron scenarios passed against matching final product sources. Sidebar
  resize and BlockNote formatting each passed in 2.9 seconds in the scoped diagnostic run; the
  final comment scenario passed in 2.35 seconds (wrapper 3.0 seconds), no automatic retries.
  The comment scenario covers real toolbar clicks, overlapping-thread selection, body-save detail
  refresh, follow-up, and resolve. Reports: `.cache/verification/1788565157736-89532-dd9101b0`
  (two passing scenarios, comment test still under diagnosis) and
  `.cache/verification/1788565196690-89831-9f4548b4` (final comment pass).
- Iterative test runs found a synthetic selection missing its pointer-up completion and clicking
  BlockNote's closing-animation HTML copy. The fixture now collapses the old selection, waits for
  the toolbar to disappear, focuses the editor, and completes the new selection gesture. Temporary
  toolbar experiments and diagnostic instrumentation were removed. The final rebuilt renderer
  is `index-D5hQc810.js`, identical to the successfully verified packaged App; no package rerun
  is required for these test-only changes.
- Runtime: macOS arm64, Electron 43.4.1 / ABI 148, host pnpm 11.17.0 and Node 26.8.1. The existing
  Node engine warning was retained; no host toolchain was replaced. Fixture providers were used.
  Live-provider UI approval continuation, Windows/Linux, and signed distribution were not tested.
