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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-30.md#local-evidence).