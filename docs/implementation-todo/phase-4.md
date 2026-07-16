# Phase 4: Project-Local Durable Work

## Phase overview

- Purpose: persist bounded project jobs, leases, retries, cancellation, scheduler execution, worker supervision, and close/reopen recovery.
- Checkpoints: 7–8.
- Current status: Completed.
- Implementation state: durable job state and runtime scheduling are complete and historically verified.

> **历史记录：适用范围已收窄。** 本 Phase 的完成记录保留了当时的资源队列、可选 `paused` 状态和辅助 LLM/rerank 调度设计。CP19.5 已将 durable jobs 限定为 MinerU parse、normalization、index/embedding build、item removal、rebuild 和 artifact cleanup；search、query embedding、rerank、provider probe、普通保存和 Agent turn 使用 request-scoped cancellation，不进入 `jobs`。

### Checkpoint 7: Persistent Job State Machine

- [x] Finalize the project-local STRICT jobs schema and state/error schemas, including claim-scoped lease tokens and durable transition history.
- [x] Include type, strict type-specific reference payload, state, priority, attempts, max attempts, `run_after`, lease owner/token, `locked_until`, heartbeat, progress, deduplication key, cancellation request, safe structured error, and timestamps.
- [x] Implement enqueue, dedupe, atomic claim, lease renewal, heartbeat, completion, retry, failure, cancellation, and optional paused transition using an opaque lease capability for owned transitions.
- [x] Use short `BEGIN IMMEDIATE` claims and transitions, atomically inserting material state/control events into `job_transitions`.
- [x] Implement startup/project-open recovery for expired leases and deterministic migration recovery for pre-v4 running jobs.
- [x] Add exponential backoff with jitter and a total failure classifier/serializer that cannot leak original error messages into portable state.
- [x] Enforce reference-only payloads through a strict per-job-type schema registry, retaining generic forbidden-key checks only as defense in depth.
- [x] Add deterministic clock and worker-identity seams.
- [x] Test lease-token isolation, expiry boundaries, arbitrary error inputs, typed payload parsing, transition history/rollback, migration upgrade, concurrency, cancellation, retry exhaustion, and project close during running work.
- [x] Emit project-correlated lifecycle events without treating logs as authoritative job history; persistent audit means material transitions and control events, not heartbeat/progress updates.

Acceptance criteria: one job is not owned by two workers; process or project closure is recoverable; payloads are bounded references; transitions are deterministic and auditable in `project.sqlite`.

Checkpoint 7 verification: schema v4 adds constrained claim-scoped lease tokens and append-only `job_transitions`; every owned operation checks job ID, worker ID, opaque token, attempt, and `locked_until > now` using one captured clock value. Failure archival logs the original top-level `err`, tolerates hostile values and classifier failures, and persists only allowlisted codes with application-controlled messages under the strict byte limit. Enqueue and database reads use strict per-type reference schemas, while the former denylist remains defense in depth. Material transitions and control events commit atomically with current-state mutations; heartbeat/progress remain intentionally excluded from history. A real schema v3 fixture is backed up and upgraded to v4 with deterministic running-job recovery, old-error sanitization, migration snapshots, `quick_check`, and `foreign_key_check`. Verification: `pnpm check` passes with one pre-existing generated shadcn sidebar cookie warning; `pnpm typecheck` passes; Electron-hosted Vitest passes 28 test files and 149 tests; `pnpm build` passes; all 4 Playwright Electron E2E tests pass; and `git diff --check` passes. No dependency, scheduler, job IPC, or Checkpoint 8 close-handling work was added.

### Checkpoint 8: Runtime Scheduler And Project Close Semantics

- [x] Install and pin p-queue 9.3.1.
- [x] Create one Main-owned `ProjectRuntime` and scheduler per open project; keep `project.sqlite` authoritative and use p-queue only for current-process resource concurrency.
- [x] Map job types to MinerU (1), embedding (3), rerank (3), indexing (1), and local I/O (2) queues; reserve auxiliary LLM concurrency (2) without inventing a job type.
- [x] Claim only when the target resource has an idle slot, preserving database priority, `run_after`, and type ordering as scheduling authority.
- [x] Dispatch claimed jobs with configured lease, heartbeat, timeout, throttled bounded progress, caught queue promises, and per-job `AbortSignal` handling.
- [x] Add a forward-only `resume_same_attempt` migration and audited project-close requeue so close/reopen never consumes a retry attempt and every resumed claim receives a new lease token.
- [x] Persist progress and expose bounded list/status/cancellation/event APIs through sender-authorized, project-session-scoped IPC without payloads, lease capabilities, worker IDs, absolute paths, provider content, or unclean errors.
- [x] Stop claiming synchronously before project close, pause resource queues, apply handler-specific finish/abort-and-requeue/recover-by-expiry/persist-before-stop policies, and enforce a bounded drain before database close.
- [x] Reject stale-session and post-stop utility messages before they can submit authoritative state.
- [x] Verify the MinerU remote-ID persistence barrier and atomic index-generation publisher as controllable handler contracts only; do not add MinerU or index domain tables before their checkpoints.
- [x] Add concurrency, priority, `run_after`, timeout/cancel/close race, heartbeat/progress, stale lease/session/message, interruption/restart, and close/reopen integration tests.

Cross-checkpoint verification responsibility: Checkpoint 15 must replace the controllable MinerU persistence-barrier handler with the real adapter and prove close/reopen resumes one persisted `remote_task_id` without duplicate submission. Checkpoint 17 must replace the controllable generation publisher with the real index utility/database implementation and prove crash-safe build plus atomic activation without duplicate or half-active generations. Checkpoint 8 does not create either future domain's tables.

Acceptance criteria: p-queue remains an execution detail; `project.sqlite` is authoritative; project reopen resumes unfinished work without duplicate external submission or duplicate index publication.

Checkpoint 8 verification: project schema v5 adds `resume_same_attempt`; audited `project_close_requeued` transitions preserve the current attempt even at `max_attempts`, and resumed claims receive a new opaque lease token. The running scheduler performs throttled expired-lease recovery after open, so a lease that expires later is recovered without another reopen. Resource claims still use database ordering and only available slots. Heartbeat and every lease transition pass through an execution-scoped supervisor gate; a prior execution cannot commit through or release a newer claim for the same job. Cancellation and close requeue are arbitrated in one `BEGIN IMMEDIATE` transaction, yielding exactly one cancellation acknowledgment or same-attempt requeue. A close drain timeout revokes commit/message authority before aborting wrappers, invokes the bounded utility termination hook, rejects close, and prevents a non-cooperative or late handler from touching the database after close. Handlers receive no lease capability. ProjectManager/runtime/JobStore integration proves open, claim, close requeue, database close, reopen, and exactly-once completion without another attempt. Job IPC remains sender-authorized, session-scoped, bounded to 100 records, and free of payload/lease/worker/path/provider capabilities. Fake handlers prove the MinerU persistence barrier and atomic index activation contract without adding future domain tables. Verification: `pnpm check` passes with one pre-existing generated shadcn sidebar cookie warning; `pnpm typecheck` passes; Electron-hosted Vitest passes 32 files and 166 tests with no unhandled rejection; `pnpm build` passes with p-queue bundled into Electron Main; all 4 Playwright Electron E2E tests pass; `pnpm build:unpack` produces `dist/mac-arm64`; and `git diff --check` passes. The unpacked build is unsigned because no valid Developer ID Application identity is configured.
