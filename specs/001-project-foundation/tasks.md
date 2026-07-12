# Tasks: 可移动项目与启动工作区基础

**Input**: Design documents from `/specs/001-project-foundation/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/contract.md`, `quickstart.md`

**Implementation gate**: `spec.md`、`plan.md`、project storage ADR 和 project IPC
contract 必须先被接受。T001 是硬门槛；在 T001 完成前不得执行会修改产品代码的任务。

**Tests**: 本 feature 改变 Electron startup、preload/shared IPC、安全边界和用户旅程，
因此包含 unit、contract、integration 和 compiled Electron smoke tasks。

**Organization**: Tasks are grouped by user story so each story can be implemented and
tested as an incremental slice after the foundational phase.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the acceptance gate and prepare deterministic local fixtures without
adding dependencies.

- [ ] T001 Confirm acceptance of `spec.md`, `plan.md`, the applicable portable-root/recent-index sections of `docs/adr/001-project-storage.md`, and the IPC contract; record the decision in `specs/001-project-foundation/checklists/plan-decisions.md`.
- [ ] T002 Verify the existing Electron/Bun toolchain and keep the dependency set unchanged in `package.json`, `bun.lock`, and `specs/001-project-foundation/research.md`.
- [ ] T003 [P] Create deterministic valid/invalid project fixtures and temporary-directory helpers in `test/fixtures/project/project-fixtures.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared domain, storage, validation, and typed IPC foundation that all
user stories require. No story implementation is complete without this phase.

- [ ] T004 [P] Define `ProjectManifest`, `WorkspaceState`, `RecentIndex`, `RecentRecord`, DTOs, and bounded error unions in `src/shared/project.ts` according to `specs/001-project-foundation/data-model.md`.
- [ ] T005 [P] Add the seven project channel constants and complete `WriteLLMIpc` method signatures in `src/shared/ipc.ts` without exposing generic IPC.
- [ ] T006 [P] Write table-driven validation tests for names, UUIDs, schema versions, required directories, timestamps, and read-only invalid-project diagnostics in `test/unit/project/project-validation.test.ts`.
- [ ] T007 [P] Write atomic JSON and create-transaction failure tests for temp-file/temporary-directory cleanup and no-valid-half-project guarantees in `test/unit/project/atomic-json.test.ts`.
- [ ] T008 [P] Write recent-index tests for five-record bounding, newest-first ordering, projectId upsert, availability refresh, and atomic index writes in `test/unit/project/recent-index.test.ts`.
- [ ] T009 [P] Implement same-directory temporary-file/temporary-directory writes and safe cleanup in `src/main/project/atomic-json.ts`, preserving existing valid data on failure.
- [ ] T010 [P] Implement portable project-name normalization, manifest/state parsing, schemaVersion checks, and required-directory validation in `src/main/project/project-validation.ts`.
- [ ] T011 Implement main-owned recent index loading, availability refresh, five-record upsert/removal, and redacted DTO projection in `src/main/project/recent-index.ts`.
- [ ] T012 Implement project create/open/validate/workspace-state operations with sibling temp-directory rename semantics in `src/main/project/project-repository.ts`.
- [ ] T013 Wire all seven named project channels through sender validation and explicit preload wrappers, updating `src/main/main.ts`, `src/preload/preload.cts`, and `src/vite-env.d.ts` without exposing paths or raw Electron objects.

**Checkpoint**: shared types, storage primitives, repository validation, recent index, and
typed bridge are ready; user-story work can proceed in priority order.

---

## Phase 3: User Story 1 - 创建或打开项目 (Priority: P1) 🎯 MVP

**Goal**: On first launch, an author can create or open a valid portable project and enter an
empty workspace; cancel, collision, validation, and storage failures are explicit.

**Independent Test**: With a temporary userData directory, create a project, close and reopen
the compiled app, open it from the launch page, and verify the empty workspace without using
any later writing feature.

### Tests for User Story 1

- [ ] T014 [P] [US1] Add contract tests for create/open request validation, dialog cancellation, bounded snapshots, stable errors, and no absolute-path leakage in `test/contract/project/create-open-ipc.test.ts`.
- [ ] T015 [P] [US1] Add launch integration tests for first-launch empty state, create success, open success, invalid-project diagnosis, collision, and cancel behavior in `test/integration/project/launch-create-open.test.ts`.

### Implementation for User Story 1

- [ ] T016 [US1] Implement `createProject` and `openProjectFromDialog` main handlers using the repository and native main-owned directory dialogs in `src/main/main.ts`.
- [ ] T017 [US1] Implement launch-page loading, empty-recent, project-name input, create/open actions, operation errors, and empty-workspace success state in `src/renderer/launch/LaunchPage.tsx` and `src/renderer/launch/launchState.ts`.
- [ ] T018 [US1] Replace the foundation status page with the launch-page/app composition in `src/renderer/App.tsx` while preserving the existing runtime error boundary.
- [ ] T019 [P] [US1] Add accessible labels, focus-visible states, dialog/error layout, and empty-workspace styling in `src/renderer/styles.css`.
- [ ] T020 [US1] Extend the compiled Electron smoke path in `scripts/electron-smoke.mjs` to verify create → open workspace → close/restart → open from recent, including canceled and failed results.

**Checkpoint**: US1 independently demonstrates FR-001–FR-004 and FR-009–FR-010.

---

## Phase 4: User Story 2 - 移动后重新发现项目 (Priority: P1)

**Goal**: A moved or renamed project is reopened as the same project, while malformed or
non-matching projects produce read-only diagnostics and never replace the original record.

**Independent Test**: Move a valid fixture, open it from its new location, relink an invalid
recent record with the same stable ID, then attempt relinking with a different valid project
and verify that the original record remains unchanged.

### Tests for User Story 2

- [ ] T021 [P] [US2] Add integration tests for move/rename reopening, malformed manifest, missing required directory, permission failure, no auto-repair, and unchanged project files in `test/integration/project/move-validation.test.ts`.
- [ ] T022 [P] [US2] Add contract tests for relink success, `PROJECT_ID_MISMATCH`, canceled relink, and error redaction in `test/contract/project/relink-ipc.test.ts`.

### Implementation for User Story 2

- [ ] T023 [US2] Implement projectId-based recent upsert for open-from-dialog and same-ID-only relinking, retaining the original record on mismatch in `src/main/project/project-repository.ts` and `src/main/main.ts`.
- [ ] T024 [US2] Add missing/invalid/inaccessible recent diagnostics, relink action, mismatch explanation, and safe retry/reselection state to `src/renderer/launch/launchState.ts` and `src/renderer/launch/LaunchPage.tsx`.
- [ ] T025 [US2] Extend compiled Electron coverage in `scripts/electron-smoke.mjs` for move/rename, same-ID relink, different-ID rejection, and invalid-folder read-only behavior.

**Checkpoint**: US1 remains functional and US2 independently demonstrates FR-005, FR-007,
and FR-011 plus the move/invalid edge cases.

---

## Phase 5: User Story 3 - 管理最近项目和移除最近记录 (Priority: P2)

**Goal**: The launch page shows at most five recent projects, preserves invalid records, lets
the author remove only a record, and persists the v1 empty-workspace recent location.

**Independent Test**: Open six valid projects, restart, verify five newest cards and ordering,
externally invalidate one, remove its recent record, and verify its project folder remains.

### Tests for User Story 3

- [ ] T026 [P] [US3] Add integration tests for five-record ordering, invalid-record retention, open-from-recent failure, remove-only-record behavior, and empty-workspace location restore in `test/integration/project/recent-management.test.ts`.
- [ ] T027 [P] [US3] Add contract tests for `listRecentProjects`, `removeRecentProject`, `saveProjectWorkspace`, redacted summaries, and no delete-project capability in `test/contract/project/recent-ipc.test.ts`.

### Implementation for User Story 3

- [ ] T028 [US3] Implement `listRecentProjects`, `removeRecentProject`, and recent-index warning/error behavior in `src/main/main.ts`, using the bounded `src/main/project/recent-index.ts` API.
- [ ] T029 [US3] Render available/missing/invalid recent cards, newest-first ordering, remove/relink/open actions, and the explicit no-project-delete boundary in `src/renderer/launch/LaunchPage.tsx`.
- [ ] T030 [US3] Implement `saveProjectWorkspace` and restore the v1 `{ kind: "workspace" }` marker through `src/main/project/project-repository.ts`, `src/main/main.ts`, and `src/renderer/launch/LaunchPage.tsx`.
- [ ] T031 [US3] Extend compiled Electron smoke coverage in `scripts/electron-smoke.mjs` for six-project bounding, restart ordering, invalid-record retention, remove-without-delete, and workspace-state persistence.

**Checkpoint**: all three stories are independently testable; US3 demonstrates FR-006–FR-008.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the completed implementation at each failure boundary and keep the design
artifacts traceable.

- [ ] T032 [P] Add compiled preload exposure assertions for exactly the named project methods, sender/input validation, redaction, and absence of `deleteProject` in `test/smoke/ipc-contract.test.ts`.
- [ ] T033 [P] Add filesystem failure-injection coverage for rename, recent-index write, permission, and interrupted-create cases in `test/runtime/project/project-failure.smoke.ts`.
- [ ] T034 [P] Re-run the documented scenarios and update only stale validation steps or expected outcomes in `specs/001-project-foundation/quickstart.md` and `specs/001-project-foundation/checklists/requirements.md`.
- [ ] T035 Run `bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:smoke`; resolve regressions in `package.json`, `scripts/electron-smoke.mjs`, and the affected `src/` or `test/` files.
- [ ] T036 Perform final Constitution and traceability review against `AGENTS.md`, `.specify/memory/constitution.md`, `specs/001-project-foundation/contract*`, `specs/001-project-foundation/data-model.md`, and `specs/001-project-foundation/plan.md`; record any approved deviation in `specs/001-project-foundation/checklists/plan-decisions.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 is the acceptance gate; T002–T003 follow it and prepare fixtures.
- **Foundational (Phase 2)**: T004–T013 depend on the accepted design and block all story work.
- **User Story 1 (Phase 3)**: T014–T020 depend on T004–T013 and deliver the MVP.
- **User Story 2 (Phase 4)**: T021–T025 depend on US1’s launch flow and the foundational repository.
- **User Story 3 (Phase 5)**: T026–T031 depend on US1’s launch flow and the recent/relink behavior from US2.
- **Polish (Phase 6)**: T032–T036 depend on all desired story checkpoints.

### Dependency Graph

```text
T001
 ├── T002 ─┐
 └── T003 ─┴── T004–T013 (Foundational)
                  │
                  └── T014–T020 (US1 / MVP)
                            ├── T021–T025 (US2)
                            └── T026–T031 (US3; after US2 for relink UI)
                                      │
                                      └── T032–T036 (Polish)
```

### Parallel Opportunities

- After T001, T002 and T003 can run in parallel because they touch separate setup/fixture paths.
- After T004–T005, T006, T007, and T008 can be written in parallel; T009 and T010 can then be implemented in parallel.
- In US1, T014 and T015 are parallel test tasks; T019 can proceed in parallel with renderer integration once the UI states are named.
- In US2, T021 and T022 are parallel test tasks; T024 is renderer-only after the main behavior in T023 is defined.
- In US3, T026 and T027 are parallel test tasks; T029 is renderer-only after the list/remove contract in T028 is stable.
- In Polish, T032, T033, and T034 can run in parallel after the story checkpoints.

### Parallel Example: User Story 1

```text
Task T014: Contract tests in test/contract/project/create-open-ipc.test.ts
Task T015: Launch integration tests in test/integration/project/launch-create-open.test.ts
Task T019: Accessible launch styles in src/renderer/styles.css
```

### Parallel Example: User Story 2

```text
Task T021: Move/validation integration tests in test/integration/project/move-validation.test.ts
Task T022: Relink contract tests in test/contract/project/relink-ipc.test.ts
```

### Parallel Example: User Story 3

```text
Task T026: Recent-management integration tests in test/integration/project/recent-management.test.ts
Task T027: Recent IPC contract tests in test/contract/project/recent-ipc.test.ts
```

## Implementation Strategy

### MVP First — User Story 1

1. Complete T001–T013 and stop if the acceptance gate is not satisfied.
2. Complete T014–T020 for create/open, empty workspace, and restart/reopen.
3. Run the US1 independent test and compiled Electron smoke before beginning US2/US3.

### Incremental Delivery

1. Add US2 for move/relink and read-only invalid diagnostics; run its independent test.
2. Add US3 for recent cards, five-entry bounding, removal, and workspace marker persistence.
3. Complete T032–T036 and run the full quickstart before implementation handoff.

### Notes

- Every task includes an exact repository path and follows `- [ ] T### [P?] [US?] description`.
- `[P]` is used only where the task can work on a different file set without an incomplete dependency.
- No task adds Git, SQLite, remote sync, provider credentials, generic IPC, project-file deletion,
  or automatic project repair.
