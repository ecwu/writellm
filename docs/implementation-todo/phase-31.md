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

- Two focused CP82 batches passed 96 and 84 tests respectively, covering explicit injection,
  dependency ordering/deduplication/cycles/limits, atomic budget fallback, non-blocking automatic
  completion and dependency failure, tool isolation, current-registry continuation, historical
  error labels, and Renderer warning projection.
- `pnpm check:fast` passed. The complete Electron gate passed 229 files and 1,253 tests with three
  benchmark skips, followed by a successful production build. Its first parallel attempt recorded
  the existing trace SQL timing variance at 10.759 seconds against a 10-second threshold; the exact
  focused benchmark passed in 1.667 seconds before the clean complete rerun.
- The updated Writing Skill E2E scenario passed independently, then `pnpm check:e2e` rebuilt the
  application and passed all 49 scenarios without failures, flakes, or skips. It verified two
  explicit roots in the first provider context without root tool calls, five authorized reference
  reads, one visible automatic complementary Skill read, and complete schema-v3 provenance.
- The scoped Impeccable detector returned no findings. `git diff --check` passed. No package,
  release, commit, tag, push, signing, notarization, promotion, or publication action was performed.
- Under separate trial-build authorization, the three intentionally changed protected Agent test
  source hashes and the obsolete fail-closed test name were refreshed in the recovery manifest.
  The complete no-Team-ID macOS arm64 package gate then passed 31 recovery fixtures from 29
  sources, 53,318 ASAR entries, all 12 packaged runtime smoke scenarios, and all 34 packaged
  Electron scenarios without failures, flakes, or skips. It produced
  `WriteLLM-0.2026.8.49-arm64.dmg` (239,010,676 bytes,
  `cfc8551ecbc8043e0cf2f7f4ca2550d8782df950fa6006751f78055008a0b10d`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,203,201 bytes,
  `0edfbf0b7b570f892b3c4d589afb12f88b598dfb3219f393c0acebc2dbc34624`) under
  `dist/macos-arm64`. No Developer ID signing, notarization, release, commit, tag, push, promotion,
  or publication action was performed.
