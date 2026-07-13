# Tasks: PDF 知识库摄取与索引

**Input**: Design documents from `specs/006-source-library-processing/`

**Prerequisites**: Accepted `spec.md`, `plan.md`, `contracts/contract.md`, ADR-005, `research.md`, `data-model.md`, and `quickstart.md`

**Tests**: Required because this feature changes Electron main/preload IPC, protected credentials, project/Git persistence, untrusted archives, external services, durable background work, and documented user journeys. For new behavior, add the listed failing test before its implementation task.

**Organization**: Tasks are grouped by user story. US1–US3 are all P1 but remain ordered by their data dependency: durable import precedes normalized parsing, which precedes indexing. US4 adds the P2 recovery and control experience on top of those independently testable capabilities.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes different files and does not depend on another unfinished task in the same batch.
- **[Story]**: Maps the task to US1, US2, US3, or US4 from `spec.md`.
- Every task names the exact file or directory it changes.

## Phase 1: Setup (Fixtures and harness entry points)

**Purpose**: Establish deterministic, non-secret inputs and compiled-runtime entry points before feature code is introduced.

- [X] T001 Create canonical source, catalog, version, block, media, job, service-status, and IPC fixture builders in `test/fixtures/sources/source-fixtures.ts`
- [X] T002 [P] Add minimal valid, scanned, table/image, encrypted, corrupt, same-name/same-size, exact-duplicate, and 500-block PDF fixture generation in `test/fixtures/sources/pdf-fixtures.ts`
- [X] T003 [P] Add deterministic MinerU archive, malicious traversal/symlink/expansion, malformed JSON, missing-media, and ordered-block fixtures in `test/fixtures/sources/mineru-fixtures.ts`
- [X] T004 [P] Register source-library compiled Electron runtime fixture entry points and environment isolation in `scripts/electron-ui-runtime.mjs`

---

## Phase 2: Foundational (Shared contracts, transactions, credentials, and durable jobs)

**Purpose**: Freeze the typed boundaries and reusable main-owned infrastructure required by every user story.

**⚠️ CRITICAL**: No user-story implementation begins until this phase passes its focused tests.

- [X] T005 [P] Add failing exact-parser, bounded DTO, discriminated removal, stable-error, service-summary, event-envelope, and redaction tests in `test/unit/sources/source-contract.test.ts`
- [X] T006 Define schema-v1 source/service DTOs, exact parsers, six source channels, seven service channels, result unions, event envelopes, and stable errors in `src/shared/sources.ts`
- [X] T007 [P] Add failing multi-file pending-manifest, atomic replace, serialized mutation, recovery, and session-fencing tests in `test/unit/project/project-transaction.test.ts`
- [X] T008 Extract reusable pending-manifest and atomic multi-file publication behavior into `src/main/project/project-transaction.ts` without changing existing chapter/orientation outcomes
- [X] T009 Refactor `src/main/project/chapter-repository.ts` and `src/main/writing-orientation/repository.ts` to consume `src/main/project/project-transaction.ts` while preserving their existing recovery contracts
- [X] T010 [P] Add failing typed Git metadata and exact processing/content trailer tests in `test/unit/project/git-repository.test.ts`
- [X] T011 Extend `src/main/project/git-repository.ts` with typed actor/event/content-change metadata and source binary/vector attributes while preserving existing human content commits
- [X] T012 [P] Add failing independent MinerU/SiliconFlow revision, atomic secret publication, unavailable protection, decrypt failure, CAS, validation timeout, and sentinel-redaction tests in `test/integration/sources/service-credentials.test.ts`
- [X] T013 Implement independent safeStorage-protected service credential repositories with no plaintext fallback in `src/main/sources/service-credentials.ts`
- [X] T014 [P] Add failing exact seven-channel, expected-sender, strict-input, provider-isolation, conflict, and redacted-result tests in `test/contract/sources/source-service-ipc.test.ts`
- [X] T015 Implement bounded credential save/remove/validate orchestration and seven expected-sender IPC handlers in `src/main/sources/service-handlers.ts`
- [X] T016 [P] Add failing JSONL append/snapshot recovery, lease expiry, idempotency, attempt-cap, persisted backoff, and supersession tests in `test/unit/sources/job-repository.test.ts`
- [X] T017 Implement schema-v1 JSONL job ledger, compact snapshots, leases, idempotency keys, and recovery parsing in `src/main/sources/job-repository.ts`
- [X] T018 [P] Add failing per-project parse concurrency, embedding concurrency, Retry-After, full-jitter backoff, shutdown abort, and active-session fencing tests in `test/unit/sources/scheduler.test.ts`
- [X] T019 Implement the main-owned scheduler, provider throttles, six-attempt policy, abort lifecycle, and project reopen recovery in `src/main/sources/scheduler.ts`
- [X] T020 Expose only the seven named `writellmSourceServices` methods and declare both isolated source namespaces in `src/preload/preload.cts` and `src/vite-env.d.ts`
- [X] T021 Register credential repositories, source service handlers, and scheduler lifecycle after app readiness without weakening `contextIsolation`, `nodeIntegration`, or `sandbox` in `src/main/main.ts`

**Checkpoint**: The application has exact shared contracts, reusable project transactions, protected service configuration, and recoverable job infrastructure, but no user-facing source workflow yet.

---

## Phase 3: User Story 1 — 批量导入资料并立即离开 (Priority: P1) 🎯 MVP

**Goal**: Acknowledge up to 100 selected PDFs quickly, durably publish unique originals, queue parse work, and recover unfinished imports without blocking writing.

**Independent Test**: Import a mixed 100-item batch, keep editing, cancel a provisional candidate, close and reopen the same project, and verify per-item outcomes, exact-content deduplication, durable originals, and one resumable parse job per accepted source.

### Tests for User Story 1

- [X] T022 [P] [US1] Add failing catalog/source/version schema, corrupt-file, unknown-version, revision, hash-uniqueness, and derived-state tests in `test/unit/sources/source-repository.test.ts`
- [X] T023 [P] [US1] Add failing native-dialog filtering, 100-item bound, unreadable/mixed batch, lightweight acknowledgement, pending copy/hash, file-change, duplicate, cancellation, and wrong-session tests in `test/integration/sources/import-service.test.ts`
- [X] T024 [P] [US1] Add failing import/list strict IPC, unauthorized sender, stale catalog revision, no-path, and no-PDF-byte contract tests in `test/contract/sources/source-import-ipc.test.ts`
- [X] T025 [P] [US1] Add failing renderer state tests for initial load, cursor paging, queued candidates, duplicate resolution, event gaps, resync, and non-blocking import in `test/unit/sources/source-library-state.test.ts`
- [X] T026 [P] [US1] Add compiled Electron tests for 100-item acknowledgement, editor responsiveness, close/reopen recovery, and exact duplicate cleanup in `test/runtime/sources/import-runtime.test.ts`

### Implementation for User Story 1

- [X] T027 [US1] Implement exact schema parsing, catalog/source/version reads, revision CAS, derived summaries, and project-session fencing in `src/main/sources/source-repository.ts`
- [X] T028 [US1] Implement main-owned PDF dialog, lightweight screening, provisional candidates, pending atomic copy, SHA-256 identity, cancellation, deduplication, and parse-job creation in `src/main/sources/import-service.ts`
- [X] T029 [US1] Implement `listSources` and `importSourcesFromDialog` handlers plus candidate-targeted removal in `src/main/sources/handlers.ts`
- [X] T030 [US1] Implement bounded per-session source event sequencing, replay buffer, candidate transitions, and resync signaling in `src/main/sources/source-events.ts`
- [X] T031 [US1] Expose the six named `writellmSources` methods and one validated receive-only event listener from `src/preload/preload.cts`
- [X] T032 [US1] Implement paged source/candidate/event state and gap-triggered authoritative reload in `src/renderer/features/sources/source-state.ts`
- [X] T033 [US1] Build the source-library list, batch import action, per-item acknowledgement, candidate cancellation, stage/progress summary, and empty/error states in `src/renderer/features/sources/SourceLibrary.tsx`
- [X] T034 [US1] Add responsive semantic-token layout and non-color queued/duplicate/failure presentation in `src/renderer/features/sources/source-library.css`
- [X] T035 [US1] Mount the source library in the accepted workspace tool slot while preserving editor state and panel orchestration in `src/renderer/App.tsx` and `src/renderer/workspace/WorkspaceShell.tsx`

**Checkpoint**: US1 independently delivers durable non-blocking import, deduplication, queue recovery, and an understandable source list.

---

## Phase 4: User Story 2 — 获得有序的结构化资料 (Priority: P1)

**Goal**: Send accepted PDFs through MinerU, reject unsafe/malformed output, and atomically publish ordered Markdown, blocks, and safe media with stable app-owned identities.

**Independent Test**: Process valid text/scanned/table/image fixtures and malicious archives; after restart, retrieve every accepted block by source/chunk identity with the same order, content, media relationships, and bounded MinerU metadata, while invalid portions remain ineligible.

### Tests for User Story 2

- [X] T036 [P] [US2] Add failing signed-upload, PUT, polling, download, 200 MB/200 page limits, auth, quota, 429, timeout, malformed response, abort, and redaction tests in `test/integration/sources/mineru-adapter.test.ts`
- [X] T037 [P] [US2] Add failing ZIP traversal, symlink, duplicate entry, expansion/entry/size cap, active-content, malformed schema, ordinal, identity, missing-media, and late-version tests in `test/unit/sources/artifact-normalizer.test.ts`
- [X] T038 [P] [US2] Add failing deterministic chunk/media identity, content split, eligibility, manifest integrity, and atomic partial-publication tests in `test/integration/sources/parse-publication.test.ts`
- [X] T039 [P] [US2] Add failing source detail pagination, bounded Markdown-as-text, media identity, no-remote-id, and invalid-output contract tests in `test/contract/sources/source-detail-ipc.test.ts`
- [X] T040 [P] [US2] Add renderer preview order, media relationship, ineligible-block, loading, and safe-text rendering tests in `test/integration/sources/source-detail.test.tsx`

### Implementation for User Story 2

- [X] T041 [US2] Implement the fixed MinerU Precision v4 signed-upload, upload, poll, immediate-download, timeout, retry classification, and redaction adapter in `src/main/sources/mineru-adapter.ts`
- [X] T042 [US2] Implement bounded ZIP central-directory validation and extraction using Node filesystem/zlib primitives in `src/main/sources/archive-reader.ts`
- [X] T043 [US2] Implement untrusted MinerU schema normalization, deterministic block splitting/identity, ordered metadata, media integrity, and eligibility in `src/main/sources/artifact-normalizer.ts`
- [X] T044 [US2] Implement version-fenced atomic Markdown/block/media manifest publication and parse-state derivation in `src/main/sources/source-repository.ts`
- [X] T045 [US2] Connect parse jobs, completed remote-result reuse, provider-aware retries, and terminal/partial publication through `src/main/sources/scheduler.ts`
- [X] T046 [US2] Implement `getSource` detail/block paging and safe media lookup in `src/main/sources/handlers.ts`
- [X] T047 [US2] Register an app-owned source media protocol with active-project, source/version, MIME, hash, and traversal validation in `src/main/sources/media-protocol.ts` and `src/main/main.ts`
- [X] T048 [US2] Build ordered structured preview, bounded block paging, media context, eligibility explanations, and parse failure states in `src/renderer/features/sources/SourceDetail.tsx`

**Checkpoint**: US2 independently proves that only normalized, identity-stable, safely previewable MinerU output becomes canonical project content.

---

## Phase 5: User Story 3 — 在后台完成内容块索引 (Priority: P1)

**Goal**: Automatically embed every eligible block with the fixed SiliconFlow profile, persist valid vectors incrementally, isolate failures, and expose only current searchable blocks to 007.

**Independent Test**: Run a 500-block fixture through success, throttling, timeout, malformed-index, wrong-dimension, NaN, permanent-failure, and restart cases; verify valid vectors persist once, incomplete work resumes, partial availability is accurate, and the main-only reader yields only current eligible blocks.

### Tests for User Story 3

- [X] T049 [P] [US3] Add failing fixed endpoint/model/encoding, 16-item/256 KiB/8192-token bounds, auth, 429, timeout, abort, response-index, count, dimension, finite-value, norm, and redaction tests in `test/integration/sources/embedding-adapter.test.ts`
- [X] T050 [P] [US3] Add failing profile identity, float32 file layout, offset/hash validation, atomic profile switch, partial checkpoint, and stale-result tests in `test/unit/sources/index-repository.test.ts`
- [X] T051 [P] [US3] Add failing per-block idempotency, two-request concurrency, Retry-After, permanent-failure isolation, restart reuse, and 95%-of-500 benchmark tests in `test/integration/sources/indexing-pipeline.test.ts`
- [X] T052 [P] [US3] Add failing current-version/profile/eligibility filtering, identity lookup, no-renderer exposure, and corrupt-vector fail-closed tests in `test/contract/sources/source-index-reader.test.ts`
- [X] T053 [P] [US3] Add renderer progress, searchable/partial counts, retrying, and permanent block-failure presentation tests in `test/integration/sources/index-progress.test.tsx`

### Implementation for User Story 3

- [X] T054 [US3] Implement the fixed SiliconFlow `BAAI/bge-m3` HTTP adapter, bounded batching, response correspondence, 1024-finite-vector validation, and stable failure mapping in `src/main/sources/embedding-adapter.ts`
- [X] T055 [US3] Implement profile-bound float32 vector persistence, embedding records, atomic profile publication, and per-block validation in `src/main/sources/index-repository.ts`
- [X] T056 [US3] Create eligible block jobs after parse, batch independent work, persist completed vectors, isolate terminal failures, and derive available/partial state in `src/main/sources/scheduler.ts`
- [X] T057 [US3] Implement the main-only current-profile `SourceIndexReader` and exact source/chunk lookup in `src/main/sources/source-index-reader.ts`
- [X] T058 [US3] Publish bounded indexed/eligible/failed progress and searchable status through source summaries/events in `src/main/sources/source-repository.ts` and `src/main/sources/source-events.ts`
- [X] T059 [US3] Render indexing progress, partial availability, searchable counts, and block-level eligibility without exposing vectors or provider internals in `src/renderer/features/sources/SourceLibrary.tsx` and `src/renderer/features/sources/SourceDetail.tsx`

**Checkpoint**: US3 independently delivers persistent partial indexing and a narrow, fail-closed 006→007 read contract.

---

## Phase 6: User Story 4 — 理解进度并安全恢复 (Priority: P2)

**Goal**: Make long-running state understandable and let users retry or remove safely without losing valid results, bypassing references, or allowing late work to resurrect data.

**Independent Test**: Inspect queued/parsing/indexing/retrying/available/partial/failed sources; retry partial work; attempt removal with known, unknown, and zero references; confirm only revision-bound zero-reference deletion succeeds and late parse/vector results cannot restore it.

### Tests for User Story 4

- [X] T060 [P] [US4] Add failing retry preservation, retrying visibility, stale revision, duplicate retry, parse/index selection, and late-result tests in `test/integration/sources/retry-source.test.ts`
- [X] T061 [P] [US4] Add failing known/unknown/unsupported citation scan, confirmation-token expiry/signature/revision binding, job supersession, tombstone, Git removal, and resurrection tests in `test/integration/sources/remove-source.test.ts`
- [X] T062 [P] [US4] Add failing six-method surface, receive-only subscription, event gap/replay, retry/remove unions, sender validation, and complete redaction tests in `test/contract/sources/source-ipc.test.ts`
- [X] T063 [P] [US4] Add retry/remove confirmation, referenced/conflict recovery, focus return, live-region, keyboard, and non-color state tests in `test/integration/sources/source-controls.test.tsx`
- [X] T064 [P] [US4] Add compiled Electron restart, wrong-project fencing, processing-commit, retry, deletion, late-result, and pending-recovery tests in `test/runtime/sources/recovery-runtime.test.ts`
- [X] T065 [P] [US4] Add 960×640, 200% text, System/Light/Dark, forced-colors, reduced-motion, keyboard-only, and progress-announcement tests in `test/runtime/sources/accessibility-runtime.test.tsx`

### Implementation for User Story 4

- [X] T066 [US4] Implement retry CAS, valid-result preservation, selective parse/index job recreation, retrying state, and stale-result fencing in `src/main/sources/source-repository.ts` and `src/main/sources/scheduler.ts`
- [X] T067 [US4] Implement fail-closed chapter citation scanning with the 007 extension seam in `src/main/sources/reference-reader.ts`
- [X] T068 [US4] Implement revision-bound short-lived confirmation tokens, candidate cancellation, referenced/unknown refusal, atomic tombstone/removal, job supersession, and processing commit in `src/main/sources/removal-service.ts`
- [X] T069 [US4] Complete `retrySource`, source-targeted `removeSource`, and replayable subscription handling in `src/main/sources/handlers.ts` and `src/main/sources/source-events.ts`
- [X] T070 [US4] Add retry, candidate cancel, source impact confirmation, referenced/conflict recovery, pending action, focus return, and safe failure UI in `src/renderer/features/sources/SourceDetail.tsx` and `src/renderer/features/sources/SourceLibrary.tsx`
- [X] T071 [US4] Add accessible status badges, progress semantics, responsive preview/control layout, forced-color borders, and reduced-motion behavior in `src/renderer/features/sources/source-library.css`

**Checkpoint**: US4 independently proves understandable recovery, safe deletion, fail-closed references, and late-result protection.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Close security, portability, performance, compiled-runtime, and registry acceptance gates across all stories.

- [X] T072 [P] Add sentinel scans proving credentials, paths, remote ids/URLs, raw bodies/errors, vectors, and temporary archives do not enter renderer DOM, IPC results, logs, diagnostics, project Git, or exports in `test/runtime/sources/source-redaction.test.ts`
- [X] T073 [P] Add project portability tests for move/reopen, canonical source/vector tracking, runtime ignore rules, structured processing trailers, and no secret/runtime intermediates in history in `test/integration/sources/source-portability.test.ts`
- [X] T074 [P] Add renderer bundle regression tests proving no Electron, Node, credential, scheduler, filesystem, network adapter, or vector implementation crosses into the renderer in `test/runtime/sources/bundle-boundary.test.ts`
- [X] T075 Run all seven scenarios from `specs/006-source-library-processing/quickstart.md` with deterministic adapters and record any fixture constraints in `specs/006-source-library-processing/quickstart.md`
- [X] T076 Run `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`, fixing only 006-related failures in the files named by this task list
- [X] T077 Verify exact six source methods, seven service methods, one receive-only event channel, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, shutdown abort, and no generic IPC in `test/runtime/sources/security-baseline.test.ts`
- [X] T078 Update the 006 completed task count and implementation status only after T001–T077 and all applicable quickstart commands pass in `specs/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately and supplies deterministic fixtures/runtime registration.
- **Foundational (Phase 2)**: Depends on Setup and blocks every user story.
- **US1 (Phase 3)**: Depends on Foundational; delivers the minimum durable source library.
- **US2 (Phase 4)**: Depends on US1 accepted originals and parse jobs.
- **US3 (Phase 5)**: Depends on US2 normalized eligible blocks.
- **US4 (Phase 6)**: Depends on US1 source identity/jobs and integrates US2/US3 retry outcomes.
- **Polish (Phase 7)**: Depends on every selected story; T078 is the final task.

### User Story Dependencies

- **US1 (P1)**: No story dependency after Foundational and is the recommended MVP.
- **US2 (P1)**: Requires US1's immutable source version and durable parse job, but remains independently testable with the accepted-source fixture.
- **US3 (P1)**: Requires US2's normalized eligible blocks, but remains independently testable with the parsed-version fixture.
- **US4 (P2)**: Retry/remove can begin after US1; final acceptance also exercises US2/US3 partial results and late outputs.

### Within Each User Story

- Add each listed failing test before its corresponding implementation and confirm it detects the intended missing behavior.
- Shared parsers precede main repositories/handlers; main behavior precedes preload/renderer wiring.
- Durable publication checks project/session/version/profile immediately before every write.
- A story reaches its checkpoint only when its independent test and focused runtime boundary pass.

### Parallel Opportunities

- T002–T004 use separate fixture/runtime files and can run in parallel after T001 begins.
- T005, T007, T010, T012, T014, T016, and T018 are independent foundational test files.
- US1 tests T022–T026, US2 tests T036–T040, US3 tests T049–T053, and US4 tests T060–T065 can run in parallel within their phases.
- T072–T074 cover different final security/portability boundaries and can run in parallel.
- Implementation tasks touching `source-repository.ts`, `scheduler.ts`, `handlers.ts`, or shared renderer files must remain in listed order.

## Parallel Example: User Story 2

```text
Task T036: MinerU transport and redaction tests
Task T037: malicious archive and normalization tests
Task T038: parse publication and identity tests
Task T039: source detail IPC contract tests
Task T040: renderer structured-preview tests
```

## Parallel Example: User Story 3

```text
Task T049: SiliconFlow adapter boundary tests
Task T050: vector/profile repository tests
Task T051: durable indexing pipeline and benchmark tests
Task T052: 006→007 reader contract tests
Task T053: renderer indexing-progress tests
```

## Implementation Strategy

### MVP First — User Story 1

1. Complete Setup and Foundational phases.
2. Complete US1 through durable import, deduplication, queue recovery, exact IPC, and source-list UI.
3. Stop and run the US1 independent test plus compiled Electron import runtime.
4. Continue to US2/US3 only after accepted originals and restart recovery are stable.

### Incremental Delivery

1. **Setup + Foundation** → protected services, durable scheduler, reusable transactions.
2. **US1** → non-blocking portable PDF import and queue recovery.
3. **US2** → validated structured Markdown/block/media publication.
4. **US3** → persistent partial embeddings and 007 reader.
5. **US4** → understandable retry/removal and fail-closed reference safety.
6. **Polish** → security, portability, performance, accessibility, and full command matrix.

## Notes

- `[P]` means separate files and no dependency on unfinished work, not merely work that could be attempted concurrently.
- Keep source paths, credentials, remote identities, raw provider data, vectors, and generic job controls out of renderer contracts.
- Do not copy product code, persistence, IPC, UI, tests, or dependencies from `legacy/v1-freeze`.
- Real MinerU/SiliconFlow smoke remains opt-in with disposable user credentials and is never a default CI prerequisite.
- Commit after each task or coherent task group; update registry implementation status to `In progress` when product-code implementation actually begins.
