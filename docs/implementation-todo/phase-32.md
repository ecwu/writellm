# Phase 32: Agent Occam Ablation And Error Propagation

## Checkpoint 83

Authority: accepted ADR 074 and the user's explicit implementation request on 2026-09-02.

### Implementation checklist

- [x] Remove event finalization and duplicate project/Worker admission limits.
- [x] Replace rolling compaction and one-recovery context state with token-derived projections.
- [x] Simplify progressive Skills and introduce backward-compatible v4 snapshots.
- [x] Remove live request retry anchors, protocol, IPC, and UI.
- [x] Make all Agent trace paths best effort and remove persistence ACKs.
- [x] Preserve safe concrete error diagnostics through Worker, Main, persistence, and Renderer.
- [x] Retain authority/no-replay invariants and legacy readers; advance Harness to v14.
- [x] Complete deterministic ablation coverage and fast/Electron/E2E/package gates.

### Structural ablation matrix

The before column records the policy and assertions at clean baseline `24f96c6` (the supplied
five-suite baseline passed 62/62). The after column names deterministic replay/fault-injection
evidence in this change, not real-provider performance measurements. The tests do not retain an
alternate legacy runtime or introduce an ablation setting.

| Removed policy / before behavior | After ablation and evidence | Retained invariant |
| --- | --- | --- |
| 180 events forced a tool-free finalization call | `session-service.tools.test.ts`: tools remain authorized beyond 180 durable events; `session-service.messages.test.ts`: 10,000 low-token lifecycle events do not force compaction | Each continuation is linked to a Main-authorized model request |
| A fourth project/Worker request was rejected with capacity state | `session-service.test.ts`: four conversations run concurrently with independent queue/Stop handling; `agent-model.test.ts`: the actual Worker entrypoint accepts five mixed Writing/Notebook sessions | A conversation still has one active run; closing a project revokes all work |
| Additional 5% reserve reduced usable input space | `context-planner.test.ts`, `agent-context-budget.test.ts`: exact context/input/output limits determine available tokens | Irreducible current requests report actual needed/available tokens |
| Compaction stopped after 4/8 steps, 2,000 events, or an indivisible huge run | `context-checkpoint.test.ts`, `session-service.compaction.test.ts`, `session-service.review.test.ts`: more than 2,000 events and huge old turns produce one summary with explicit oldest-event omissions | Current requests and active tool batches stay intact; stored raw events remain unchanged |
| Independent 32K/half-window/checkpoint targets consumed context | `context-planner.test.ts`, `context-checkpoint.test.ts`: summary and contiguous recent raw tail derive from current model and generic byte limits, including checkpoint-only re-summary | V1–V3 checkpoints remain readable; V4 stores coverage, omissions, token estimates, and prior checkpoint identity |
| A second oversized read terminated recovery | `agent-context-budget.test.ts`: each oversized read batch is independently projected and can be followed by smaller reads; Worker replay continues through the ordinary Pi loop | Mutation/effect results are never projected or automatically replayed |
| Skill entrypoint exclusivity and 4-root/8-dependency/12-reference/32-KiB totals rejected useful reads | `skill-router.test.ts`, `agent-session-run.test.ts`: larger root/dependency/reference sets and mixed read-only batches run normally | Manifest URI authorization, normalized paths, fixed commit/hash, and per-file payload boundaries still reject invalid reads |
| Explicit mentions required atomic dependency closure and reference loading prerequisites | `skill-router.test.ts`, `session-service.messages.test.ts`: roots are injected, references are readable from the authorized manifest, and unread/unavailable dependencies do not block a useful answer | New runs resolve against the full installed registry; V1–V3 snapshots remain readable |
| Trace ACK, serialization, or SQLite failure could prevent provider work | `agent-model-client.test.ts`, `agent-model-request.test.ts`, `agent-session-run.test.ts`, `trace-repository.test.ts`: blocked/rejected delivery and serialization/capacity/SQLite faults do not stop completion; storage records diagnostic gaps when possible | Trace never grants authority; storage byte limits and raw-error logging remain |
| Exhaustion exposed a one-use live retry capability and recovery panel | `session-service.messages.test.ts`, `agent-session-run.test.ts`, `e2e/agent-writing.spec.ts`: exhaustion is terminal; the next user message starts a normal run without transient warnings | Five pre-content attempts, one pre-activity overflow recovery, no post-content retry, approval, mutation serialization, and Stop remain |
| Generic failure messages and mandatory one-retry tool advice hid the cause | `agent-diagnostic-error.test.ts`, service/client/Worker tests, and Renderer timeline tests: concrete message/code/stage/status/causes survive persistence and presentation, including legacy code-only records | Credentials, headers/cookies, signed URLs, private bodies, and absolute paths are redacted; one total diagnostic byte boundary limits cause traversal |

### Retained boundary inventory

- IPC/Zod envelopes, sender authorization, revocable project/session/run identities, and path/hash
  validation protect authority; none is an optional performance preference.
- Single-conversation work, approval barriers, optimistic revision checks, one isolated mutation per
  tool batch, and `ask_user` answer identity prevent races or duplicate side effects.
- Pending queues, event pages, live partials, Notebook's ephemeral chat/citation payloads, Skill
  per-file reads, and trace storage retain bounded memory/serialization contracts. They are not
  global model-admission counters. No new threshold or setting was introduced.
- Legacy `model_retry`, `maxAttempts`, Skill/compaction snapshots, trace failure status, and code-only
  run errors remain read-only compatibility data. No table or historical row was migrated/deleted.

### Local evidence

- Baseline: clean `24f96c6`; five focused suites passed 62/62 before implementation.
- Focused integration batches passed: Agent service plus Notebook 83/83; context/Worker/client
  71/71; Skill routing/contracts 19/19; Agent Renderer 58/58; protocol/IPC/diagnostic 28/28.
- Removed stale tests for the deleted retry IPC, capacity field, protocol v13, and retry-once prose.
  A parallel full-suite run also exposed a trace SQL reconstruction wall-clock assertion despite
  correct data. Its replacement verifies round-trip equality and actual deduplication, not a
  machine-load-dependent ten-second threshold.
- The recovery manifest is refreshed for the five changed Agent test sources and shared logger
  tests; all 31 synthetic
  fixtures from 29 sources pass verification. It now indexes continuation, lossy compaction, and
  ordinary next-run behavior rather than the deleted guards.
- Integration review additionally covered file-URI/UNC/POSIX path redaction, credentials embedded
  in error text, and unlabelled private bodies in original errors. Pino and the Worker log port
  reuse the safe diagnostic associated with the original Error identity; tests verify the actual
  serialized output, not only a logger spy. No request-body field is added to log records.
- Compaction before/after estimates now measure runtime history on both sides, rather than
  comparing summary-source tokens to final history. An unfit checkpoint envelope reports its
  actual capacity before a summary provider call.
- The first full E2E run passed 43/49 and exposed five obsolete assertion/timing assumptions plus
  one real missing trace identity registration for `commit_follow_up_steer`. The Main bridge now
  registers that authorized request before delivery, with a dedicated regression replay.
- The second E2E run passed 48/49; the remaining fixture still recognized summary requests by old
  prompt prose. It now recognizes the stable `WRITELLM_PRIOR_EVENTS` boundary instead.
- Final privacy coverage includes Notebook question redaction, literal/non-JSON credentials,
  preserving status/detail following an inline Authorization header, safe repeated diagnostic
  serialization, and provider completion even when trace error reporting itself throws.
- `pnpm check:fast` and the final Electron-hosted suite/build passed: 231 files, 1,275 tests, and
  three explicitly skipped benchmarks. Runtime: Electron 43.4.1, bundled Node 24.18.1, ABI 148.
  The exact pinned pnpm 11.17.0 was used; the host launcher is Node 26.8.1 and prints the existing
  engine-range warning, while native tests/build preparation use the correct Electron ABI.
- The final fresh `pnpm check:e2e` passed all 49 scenarios in the default silent mode, without
  failures, flakes, or skips. Its evidence manifest SHA-256 is
  `2c0937c09ddbee90bb8baa4a765f82acc9ecc3b54488026d90e950a9626a55ed`.
- The scoped Impeccable detector returned no findings. Existing shadcn disclosure components
  carry diagnostic details; no replacement recovery panel or visual system was introduced.
- Production TypeScript/TSX changed by 3,145 additions and 3,923 deletions, a net reduction of
  778 lines, including new untracked runtime modules and excluding tests/test-support/docs.
- `pnpm check:package` passed the complete default silent macOS arm64 gate: 31 recovery fixtures
  from 29 sources, 53,318 ASAR entries, 12 packaged runtime smoke scenarios, and 34/34 packaged
  Electron scenarios, without failures, flakes, or skips. Native modules match Electron ABI 148
  and arm64. Apple identity discovery was disabled and the App has no Team identity; only the
  permitted upstream ad-hoc/linker signature remains. Evidence is in
  `dist/macos-arm64/package-evidence.json` against baseline revision `24f96c6` plus this worktree.
- Package artifacts: `WriteLLM-0.2026.8.49-arm64.dmg` (239,031,387 bytes,
  SHA-256 `c705458ccc8ec5fa0093ea8b75ac2dec976f82e3bfc2054dd165bb39b98e684b`) and
  `WriteLLM-0.2026.8.49-arm64.zip` (237,198,426 bytes,
  SHA-256 `704b0ecb867dfe7deac75106503b5b955a3b17c489835be8f116b7a6bc347801`).
  Both are structurally verified trial artifacts, not a new tagged or published release.
- Final `pnpm check` and `git diff --check` passed after evidence/document synchronization.
- Upstream limitation: when Pi itself has already normalized an asynchronous provider exception
  into `AssistantMessage.errorMessage`, its discarded original cause/code cannot be reconstructed.
  The adapter preserves the message/status it actually receives and preserves complete causes
  for original errors exposed to WriteLLM; it does not fabricate diagnostics or fork Pi.
- No real-provider calls, migration, new dependency/setting, release, Developer ID signing,
  notarization, commit, tag, or push was performed. `check:release` was not run.
