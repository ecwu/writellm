# Phase 30: Token-Pressure Agent Context Compaction

Status: Checkpoint 81 is complete under accepted ADR 072.

Recorded: 2026-09-01

## Checkpoint 81: Preserve Work Intent Without Event-Count Compaction

### Outcome

Make ordinary automatic compaction depend only on the final model-visible token budget, strengthen
the existing single-pass rolling handoff so the latest real user request remains the action source,
and expose immediate manual compaction through `/compact`.

### Implementation

- [x] Remove the 200-event and 2-MiB branches and their planner inputs while preserving final token
  accounting and provider-overflow recovery.
- [x] Make previous-checkpoint merging, newer-conversation precedence, and background-only `Next
  action` semantics explicit in the compaction and runtime checkpoint wrappers.
- [x] Add a slash-only `Compact conversation` action that invokes the existing manual compaction
  path immediately and leaves the Add-context catalog and header confirmation flow unchanged.
- [x] Add focused token-trigger, 10,000-tool-event, checkpoint ordering, prompt-contract, and slash
  catalog coverage.
- [x] Complete `check:fast`, the Electron gate, fresh relevant E2E, and diff checks; record exact
  local evidence before marking the checkpoint complete.

### Acceptance boundaries

- No database migration, shared Agent protocol, IPC/preload method, dependency, Worker role,
  provider-specific prompt, second summary call, or persistent memory authority.
- Provider overflow remains a one-time pre-activity recovery and never replays assistant/tool work.
- The 2,000-event source ceiling, complete-run boundary, 180-event finalization, payload-v3, typed
  projection, and raw-event authority remain unchanged.

### Local evidence

- Focused planner, prompt, checkpoint, Main integration, and Renderer logic coverage passed 59
  tests, including 10,000 low-token tool events and the 51,806-token/1,048,576-token reproduction.
- `pnpm check:fast` passed. The Electron gate passed 229 files and 1,246 tests with three benchmark
  skips, followed by a successful production build. A transient parallel-suite trace reconstruction
  measurement was isolated and passed in 1.86 seconds on focused rerun before the final clean gate.
- Fresh full Electron E2E passed all 49 scenarios without failures, flakes, or skips. The grounded
  Agent scenario verified the header confirmation remains and `/compact` clears the composer,
  performs exactly one existing manual compaction call, and creates no ordinary user turn.
- `git diff --check` passed. No package, release, commit, tag, push, signing, notarization,
  promotion, or publication action was performed.
- Under separate user authorization, the complete no-Team-ID macOS arm64 package gate passed 31
  recovery fixtures from 29 sources, verified 53,318 ASAR entries and all 12 packaged runtime
  smoke scenarios, and passed all 34 packaged Electron scenarios without failures, flakes, or
  skips. It produced `WriteLLM-0.2026.8.49-arm64.dmg` (239,010,230 bytes,
  `e69917cb1e44b1125962b68b3d790bb279e24172381facc76325ecd24e7a49c4`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,206,167 bytes,
  `6779135acae153e2d4528df991a51fb4477824d5e626e5230c9ec264f07d8bad`) under
  `dist/macos-arm64`. No Developer ID signing, notarization, tag, release, promotion, or
  publication action was performed.
