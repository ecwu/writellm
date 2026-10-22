# Phase 31: Explicit Writing Skill Injection and Non-Blocking Auto Loading

Status: Checkpoint 82 is complete under accepted ADR 073.

Recorded: 2026-09-01

## Checkpoint 82: Keep Explicit Injection and Automatic Reads Distinct

### Outcome

Resolve leading `$skill-name` requests into one Main-owned, dependency-complete prompt package
before the first provider call, while retaining visible progressive automatic reads and removing
the system-level failure detector for incomplete Skill preparation.

### Implementation

- [x] Parse explicit mentions in Main and atomically inject ordered roots plus a stable,
  deduplicated dependency closure.
- [x] Degrade explicit ambiguity, unavailability, cycles, limits, integrity, and context-budget
  failures without terminating the Agent run or injecting a partial package.
- [x] Remove assistant-text, downstream-tool, final-answer, and settlement gates tied to complete
  Skill preparation; retain recoverable one-entrypoint and no-mixed-tool protocol errors.
- [x] Route every new run from current user text and the current registry rather than replaying a
  previous run's Skill snapshot.
- [x] Preserve schema-v3 provenance and historical `skill_request_unfulfilled` compatibility, and
  show only a compact non-terminal warning for explicit injection degradation.
- [x] Complete focused tests, `check:fast`, the Electron/build gate, fresh E2E, the scoped UI
  detector, and diff checks; record exact evidence before marking the checkpoint complete.

### Acceptance boundaries

- No database migration, new IPC method, provider request, classifier, persistent selector,
  attachment, chip, dependency, executable Skill content, or new file/network authority.
- Explicit success creates no synthetic tool activity or success badge. Automatic reads remain
  visible and record only actually loaded roots, dependencies, and references.
- Historical run snapshots remain immutable audit evidence; ADR 071 live same-request retry remains
  unchanged.

### Local evidence

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-31.md#local-evidence).